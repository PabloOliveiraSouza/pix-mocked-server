import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { MemoryDB } from "../../libs/fakedb";
import { PixID, PixKey, PixRequest, TipoCob, Situacao, ModalidadeAlteracao, IPaginator, Expiracao } from "./models";
import { getMD5Hash } from "../../libs/utils";
import { randomUUID } from "crypto";
import { MESSAGES } from "../../libs/messages";
import { CobGetResponse, CobPatchRequest, CobPutRequest, CobPutResponse, CobGetFilter, CobPatchResponse, CobValor } from "./models/cob";
import { LocGetResponse, LocGetFilter, LocID, LocPutRequest, LocPutResponse } from "./models/loc";
import { CobVGetFilter, CobVGetResponse, CobVPatchRequest, CobVPatchResponse, CobVPutRequest, CobVPutResponse, CobVValor } from "./models/cobv";
import { CobRGetFilter, CobRGetResponse, CobRPatchRequest, CobRPatchResponse, CobRPutRequest, CobRPutResponse, StatusCobR, TentativaCobR, TipoTentativaCobR } from "./models/cobr";
import { PoliticaRetentativa, RecGetFilter, RecGetResponse, RecPatchRequest, RecPostRequest, RecRequest, StatusRec } from "./models/rec";
import { owners } from '../../data/db.json'

type AnyCobGetResponse = CobGetResponse | CobVGetResponse | CobRGetResponse;
type AnyCobGetFilter = CobGetFilter | CobVGetFilter | CobRGetFilter;

const MAX_RETENTATIVAS = 3;
const JANELA_RETENTATIVA_DIAS = 7;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Injectable()
export class PSP {

    private cob: MemoryDB;
    private cobR: MemoryDB;
    private cobV: MemoryDB;
    private transHist: MemoryDB;
    private locations: MemoryDB;
    private correntistas: MemoryDB;
    private loccob: MemoryDB;
    private rec: MemoryDB;

    constructor() {

        this.cob = MemoryDB.get("COB");
        this.transHist = MemoryDB.get("COB_HIST");

        this.cobR = MemoryDB.get("COBR");
        this.cobV = MemoryDB.get("COBV");

        this.locations = MemoryDB.get("LOCATIONS");
        this.correntistas = MemoryDB.get("CORRENTISTAS");
        this.loccob = MemoryDB.get("LOC_COB");

        this.rec = MemoryDB.get("REC");

    }

    //COB e COBV compartilham a coleção COB; COBR é persistida em COBR
    private collection(tipoCob: TipoCob): MemoryDB {
        return tipoCob === TipoCob.recorrencia ? this.cobR : this.cob;
    }

    private editableStatus(tipoCob: TipoCob): string[] {
        return tipoCob === TipoCob.recorrencia ? [StatusCobR.Criada, StatusCobR.Ativa] : [Situacao.Ativa];
    }

    private paginate<T>(filter: { inicio: string, fim: string, paginacao?: { paginaAtual: number, itensPorPagina: number } }, items: T[]) {
        const paginaAtual = Number(filter.paginacao?.paginaAtual) || 0;
        const itensPorPagina = Number(filter.paginacao?.itensPorPagina) || 100;
        const ini = paginaAtual * itensPorPagina;
        const parametros: IPaginator['parametros'] = {
            inicio: filter.inicio,
            fim: filter.fim,
            paginacao: {
                paginaAtual,
                itensPorPagina,
                quantidadeDePaginas: Math.ceil(items.length / itensPorPagina),
                quantidadeTotalDeItens: items.length
            }
        };
        return { parametros, items: items.slice(ini, ini + itensPorPagina) };
    }

    private inPeriod(criacao: string, filter: { inicio: string, fim: string }) {
        const [c, inicio, fim] = [new Date(criacao), new Date(filter.inicio), new Date(filter.fim)];
        return c >= inicio && c <= fim;
    }

    private async joinLocCob(IdOwner: string, txid: string, id: number, tipoCob: TipoCob) {
        const lc2 = await this.loccob.read(IdOwner, { id });
        const loc = await this.locations.read(IdOwner, { id })

        if (lc2) {
            throw new BadRequestException('LOCATION JÁ ESTÁ VINCULADO A UMA COBRANÇA');
        }

        if (!loc) {
            throw new BadRequestException(MESSAGES.Errors.defaults.NOT_FOUNT('location'));
        }

        if (loc.tipoCob != tipoCob) {
            throw new BadRequestException(MESSAGES.Errors.defaults.UNEXPECTED_VALUE('tipoCob', loc.tipoCob));
        }

        await this.loccob.add(IdOwner, { txid, id });
    }

    private async _addCob(itm: PixRequest<CobPutRequest | CobVPutRequest | CobRPutRequest>, tipoCob: TipoCob) {
        const valor = itm.data.valor as CobValor;

        if (valor?.retirada) {
            throw new BadRequestException('NÃO IMPLEMENTADO: valor.retirada não é suportado por este mock.');
        }

        if ((await this.cob?.read(itm.IdOwner, { txid: itm.txid })) || (await this.cobR?.read(itm.IdOwner, { txid: itm.txid }))) {
            throw new BadRequestException({ txid: 'O campo $$ já foi utilizado por outra cobrança.' });
        }

        if (valor && !valor.modalidadeAlteracao && tipoCob !== TipoCob.recorrencia) {
            valor.modalidadeAlteracao = ModalidadeAlteracao.NaoEditavel;
        }

        if (tipoCob == TipoCob.imediato) {
            const data = itm.data as CobPutRequest;
            if (!data.calendario || !(data.calendario as Expiracao)?.expiracao) {
                data.calendario = { expiracao: 86400 }
            }
        }

        const status = tipoCob === TipoCob.recorrencia ? StatusCobR.Criada : Situacao.Ativa;
        const curr = { ...itm.data, txid: itm.txid, revisao: 0, status, criacao: (new Date()).toJSON() };

        //INCLUI  LOCATION E TRANSAÇÃO, PARA DEPOIS VINCULÁ-LAS  
        const { id } = await this.addLoc({ tipoCob, IdOwner: itm.IdOwner })
        await this.collection(tipoCob).add(itm.IdOwner, curr);
        await this.joinLocCob(itm.IdOwner, itm.txid, id, tipoCob);

        return await this._readCob({ IdOwner: itm.IdOwner, txid: itm.txid }, undefined, tipoCob);
    }

    async addCob(itm: PixRequest<CobPutRequest>): Promise<CobPutResponse> {
        return (await this._addCob(itm, TipoCob.imediato)) as CobPutResponse;
    }

    async addCobR(itm: PixRequest<CobRPutRequest>): Promise<CobRPutResponse> {
        const rec: RecGetResponse = await this.rec?.read(itm.IdOwner, { idRec: itm.data.idRec });

        if (!rec) {
            throw new BadRequestException({ idRec: 'O campo $$ não corresponde a uma recorrência existente.' });
        }
        if ([StatusRec.Cancelada, StatusRec.Rejeitada, StatusRec.Expirada].includes(rec.status)) {
            throw new BadRequestException({ idRec: `O campo $$ corresponde a uma recorrência com status ${rec.status}.` });
        }

        const data = {
            ...itm.data,
            valor: itm.data.valor?.original ? itm.data.valor : { original: rec.valor.valorRec },
            politicaRetentativa: rec.politicaRetentativa,
            tentativas: [] as TentativaCobR[]
        };
        return (await this._addCob({ ...itm, data }, TipoCob.recorrencia)) as CobRPutResponse;
    }

    async addCobV(itm: PixRequest<CobVPutRequest>): Promise<CobVPutResponse> {
        return (await this._addCob(itm, TipoCob.vencimento)) as CobVPutResponse;
    }

    async _readCob<T extends AnyCobGetResponse>(key: PixKey, revisao?: number, tipoCob: TipoCob = TipoCob.imediato): Promise<T> {

        const last = () => this.collection(tipoCob).read(key.IdOwner, { txid: key.txid });
        const hist = () => this.transHist.read(key.IdOwner, { id: getMD5Hash(key.txid, revisao) });

        const curr = revisao ? (await hist()) || (await last()) : (await last());
        if (!curr) { return undefined }

        if (curr.chave) {
            const c = await this.correntistas.read("DEV", { chave: curr.chave });
            if (!c) { throw new NotFoundException(MESSAGES.Errors.defaults.NOT_FOUNT('Correntista')) }
        }

        const loccob = await this.loccob.read(key.IdOwner, { txid: curr.txid });
        let loc: LocGetResponse = undefined;

        if (loccob) {
            loc = await this.locations.read(key.IdOwner, { id: loccob.id });
            if (!loc) { throw new NotFoundException(MESSAGES.Errors.defaults.NOT_FOUNT('Location')) }
            loc.location = `pix.example.com/qr/${loc.uuid}`
        }

        const res = {
            ...curr,
            loc: loc,
            location: loc?.location
        }

        return res;
    }

    async readCob(key: PixKey, revisao?: number): Promise<CobGetResponse> {
        return await this._readCob(key, revisao);
    }

    async readCobV(key: PixKey, revisao?: number): Promise<CobVGetResponse> {
        return await this._readCob(key, revisao);
    }

    async readCobR(key: PixKey, revisao?: number): Promise<CobRGetResponse> {
        return await this._readCob(key, revisao, TipoCob.recorrencia);
    }

    async _listCob(filter: AnyCobGetFilter & { IdOwner: string }, tipoCob: TipoCob = TipoCob.imediato): Promise<IPaginator & { cobs: AnyCobGetResponse[] }> {
        const empty = () => {
            const { parametros } = this.paginate(filter, []);
            return { parametros, cobs: [] };
        };

        let chave: string = undefined;
        let idRecs: string[] = undefined;
        const documento = filter.cnpj || filter.cpf;

        if (documento && tipoCob === TipoCob.recorrencia) {
            //COBR NÃO POSSUI CHAVE: FILTRA PELO DEVEDOR DA RECORRÊNCIA VINCULADA
            const recs: RecGetResponse[] = await this.rec.list(filter.IdOwner);
            idRecs = recs.filter(r => r.vinculo?.devedor?.cpf === documento || r.vinculo?.devedor?.cnpj === documento).map(r => r.idRec);
        }
        else if (documento) {
            const correntista = await this.correntistas.read("DEV", { cpfcnpj: documento })

            //CORRENTISTA NÃO ENCONTRADO RETORNA LISTA VAZIA
            if (!correntista) {
                return empty();
            }
            else {
                chave = correntista.chave
            }
        }

        const idRec = (filter as CobRGetFilter).idRec;
        const ls = await this.collection(tipoCob).list(filter.IdOwner);

        let cobs = await Promise.all(
            ls.filter((f: any) =>
                this.inPeriod(f.criacao, filter) &&
                (!chave || f.chave === chave) &&
                (!filter.status || f.status === filter.status) &&
                (!idRecs || idRecs.includes(f.idRec)) &&
                (!idRec || f.idRec === idRec)
            )
                .map<Promise<AnyCobGetResponse>>(m => this._readCob({ IdOwner: filter.IdOwner, txid: m.txid }, undefined, tipoCob))
        );

        if (filter.locationPresente !== undefined) {
            const presente = filter.locationPresente === true || (filter.locationPresente as unknown) === 'true';
            cobs = cobs.filter((f: AnyCobGetResponse) => (!!f.loc?.id && presente) || (!f.loc?.id && !presente));
        }

        const { parametros, items } = this.paginate(filter, cobs);
        return { parametros, cobs: items }
    }

    async listCob(filter: CobGetFilter & { IdOwner: string }) {
        return await this._listCob(filter)
    }

    async listCobV(filter: CobVGetFilter & { IdOwner: string }) {
        return await this._listCob(filter)
    }

    async listCobR(filter: CobRGetFilter & { IdOwner: string }) {
        return await this._listCob(filter, TipoCob.recorrencia)
    }

    async _editCob(itm: PixRequest<CobPatchRequest | CobVPatchRequest | CobRPatchRequest>, tipoCob: TipoCob) {
        const curr: any = await this._readCob(itm, undefined, tipoCob);
        const data: any = itm.data;
        const coll = this.collection(tipoCob);
        let add = false;

        if (!curr || !this.editableStatus(tipoCob).includes(curr.status)) {
            return null
        }
        else {
            if (!!data.devedor || !!data.dadosDevedor || !!data.solicitacaoPagador || !!data.infoAdicional || !!data.valor || !!data.calendario || data.status) {
                add = true
            }

            if (data.loc?.id != null) {
                const lc = await this.loccob.read(itm.IdOwner, { txid: itm.txid });

                if (lc?.id != data.loc.id) {
                    if (lc) { await this.loccob.remove(itm.IdOwner, { id: lc.id }); }
                    try { await this.joinLocCob(itm.IdOwner, itm.txid, data.loc.id, tipoCob); }
                    catch (ex) {
                        if (lc) { await this.loccob.add(itm.IdOwner, { id: lc.id, txid: itm.txid }); } //desfaz a exclusão
                        throw ex;
                    }
                }
            }

            const histId = getMD5Hash(curr.txid, curr.revisao);
            if (add) {
                await this.transHist.add(itm.IdOwner, { id: histId, ...curr });
                curr.revisao++;

                data.valor = tipoCob === TipoCob.recorrencia
                    ? { original: data.valor?.original || curr.valor?.original }
                    : {
                        original: data.valor?.original || curr.valor.original,
                        modalidadeAlteracao: data.valor?.modalidadeAlteracao || curr.valor.modalidadeAlteracao
                    };

                if (tipoCob === TipoCob.vencimento && data.valor) {
                    const valor = data.valor as CobVValor;
                    const currV = curr.valor as CobVValor;
                    data.valor = {
                        ...data.valor,
                        desconto: {
                            data: valor.desconto?.data || currV.desconto.data,
                            modalidade: valor.desconto?.modalidade || currV.desconto.modalidade,
                            valorPerc: valor.desconto?.valorPerc || currV.desconto.valorPerc
                        },
                        juros: {
                            modalidade: valor.juros?.modalidade || currV.juros.modalidade,
                            valorPerc: valor.juros?.valorPerc || currV.juros.valorPerc
                        },
                        multa: {
                            modalidade: valor.multa?.modalidade || currV.multa.modalidade,
                            valorPerc: valor.multa?.valorPerc || currV.multa.valorPerc
                        }
                    }
                }

                await coll.update(itm.IdOwner, { txid: itm.txid }, { ...curr, ...data });
            }
            else {
                await coll.patch(itm.IdOwner, { txid: itm.txid }, { loc: curr.loc });
            }

            return await this._readCob({ IdOwner: itm.IdOwner, txid: itm.txid }, undefined, tipoCob);
        }
    }

    async editCob(itm: PixRequest<CobPatchRequest>): Promise<CobPatchResponse> {
        return (await this._editCob(itm, TipoCob.imediato)) as CobPatchResponse;
    }

    async editCobV(itm: PixRequest<CobVPatchRequest>): Promise<CobVPatchResponse> {
        return (await this._editCob(itm, TipoCob.vencimento)) as CobVPatchResponse;
    }

    async editCobR(itm: PixRequest<CobRPatchRequest>): Promise<CobRPatchResponse> {
        return (await this._editCob(itm, TipoCob.recorrencia)) as CobRPatchResponse;
    }

    async retentativaCobR(key: PixKey, dataLiquidacao: string): Promise<CobRGetResponse> {
        const parsed = new Date(`${dataLiquidacao}T00:00:00.000Z`);
        if (!DATE_PATTERN.test(dataLiquidacao || '') || isNaN(+parsed)) {
            throw new BadRequestException({ data: 'O campo $$ não respeita o schema.' });
        }

        const curr: CobRGetResponse = await this.cobR.read(key.IdOwner, { txid: key.txid });
        if (!curr) {
            throw new NotFoundException();
        }

        const rec: RecGetResponse = await this.rec?.read(key.IdOwner, { idRec: curr.idRec });
        if (!rec || rec.politicaRetentativa !== PoliticaRetentativa.Permite) {
            throw new BadRequestException('A recorrência vinculada à cobrança não permite retentativas.');
        }

        if (!this.editableStatus(TipoCob.recorrencia).includes(curr.status)) {
            throw new BadRequestException(`A cobrança recorrente com status ${curr.status} não admite retentativas.`);
        }

        const tentativas = curr.tentativas || [];
        if (tentativas.filter(f => f.tipo === TipoTentativaCobR.Retentativa).length >= MAX_RETENTATIVAS) {
            throw new BadRequestException(`O limite de ${MAX_RETENTATIVAS} retentativas foi atingido.`);
        }

        const hoje = new Date(new Date().toJSON().substring(0, 10) + 'T00:00:00.000Z');
        const vencimento = new Date(`${curr.calendario?.dataDeVencimento?.substring(0, 10)}T00:00:00.000Z`);
        const limite = new Date(+vencimento + JANELA_RETENTATIVA_DIAS * 86400000);
        if (parsed < hoje || (!isNaN(+limite) && parsed > limite)) {
            throw new BadRequestException({ data: `O campo $$ deve estar entre a data atual e ${JANELA_RETENTATIVA_DIAS} dias após o vencimento.` });
        }

        const tentativa: TentativaCobR = { tipo: TipoTentativaCobR.Retentativa, dataLiquidacao, status: "SOLICITADA", criacao: new Date().toJSON() };
        await this.cobR.patch(key.IdOwner, { txid: key.txid }, { tentativas: [...tentativas, tentativa] });

        return await this.readCobR(key);
    }

    async _removeCob(key: PixID & { IdOwner: string }, tipoCob: TipoCob = TipoCob.imediato): Promise<boolean> {
        await this.loccob.remove(key.IdOwner, { txid: key.txid });
        return await this.collection(tipoCob).remove(key.IdOwner, { txid: key.txid });
    }
    async removeCob(key: PixID & { IdOwner: string }): Promise<boolean> {
        return this._removeCob(key);
    }
    async removeCobV(key: PixID & { IdOwner: string }): Promise<boolean> {
        return this._removeCob(key);
    }
    async removeCobR(key: PixID & { IdOwner: string }): Promise<boolean> {
        return this._removeCob(key, TipoCob.recorrencia);
    }

    async readLoc({ IdOwner, id }: LocID & { IdOwner: string }): Promise<LocGetResponse> {
        const itm: any = await this.locations.read(IdOwner, { id });
        if (itm) {
            const lc = await this.loccob.read(IdOwner, { id })
            return { ...itm, ...(lc?.txid ? { txid: lc?.txid } : {}), location: `pix.example.com/qr/${itm.uuid}` }
        }
    }
    async listLoc(filter: LocGetFilter & { IdOwner: string }) {

        const res = {
            parametros: {
                inicio: filter.inicio,
                fim: filter.fim,
                paginacao: {
                    paginaAtual: filter.paginacao?.paginaAtual || 0,
                    itensPorPagina: filter.paginacao?.itensPorPagina || 100,
                    quantidadeDePaginas: 0,
                    quantidadeTotalDeItens: 0
                }
            }
        };

        //Carrega Locations e correlação entre Location e Cob(x)
        const ls = await Promise.all([
            this.locations.list(filter.IdOwner),
            this.loccob.list(filter.IdOwner)
        ]).then(([_locs, _cobs]) => {

            if (filter.tipoCob !== undefined) {
                _locs = _locs.filter((f: LocGetResponse) => f.tipoCob === filter.tipoCob);
            }

            //Left Join Loc x LocCob
            return _locs.map(m => {
                const _cob = _cobs.find(f => f.id === m.id);
                return _cob ? { ...m, txid: _cob.txid, location: `pix.example.com/qr/${m.uuid}` } : m;
            })
        });

        let loc = ls.filter((f: any) => {
            const [criacao, inicio, fim] = [new Date(f.criacao), new Date(filter.inicio), new Date(filter.fim)]
            return criacao >= inicio && criacao <= fim
        })

        if (filter.txIdPresente !== undefined) {

            loc = loc.filter((f: LocGetResponse & { cob: any }) => {
                const res = (!!f.txid && !!filter.txIdPresente) || (!f.txid && !filter.txIdPresente)
                return res;
            });
        }

        const ini = res.parametros.paginacao.paginaAtual * res.parametros.paginacao.itensPorPagina;
        const fim = ini + res.parametros.paginacao.itensPorPagina;
        res.parametros.paginacao.quantidadeDePaginas = Math.ceil(loc.length / res.parametros.paginacao.itensPorPagina)
        res.parametros.paginacao.quantidadeTotalDeItens = loc.length;
        return { ...res, loc: loc.slice(ini, fim) }
    }

    async readLocUUID(IdOwner: string, uuid: string): Promise<LocGetResponse> {
        const itm: any = await this.locations.read(IdOwner, { uuid });
        if (itm) {
            const lc = await this.loccob.read(IdOwner, { id: itm.id })
            return { ...itm, txid: lc?.txid, location: `pix.example.com/qr/${itm.uuid}` }
        }
    }

    async addLoc({ tipoCob, IdOwner }: LocPutRequest & { IdOwner: string }): Promise<LocPutResponse> {
        await (() => new Promise<void>(res => setTimeout(() => res(), 100)))(); //delay -- WORKAROUND PRA EVITAR COLISÃO DE ID DURANTE OS TESTES
        const id = + new Date();
        const itm = { id, tipoCob, uuid: randomUUID().replace(/\-/g, ''), criacao: (new Date()).toJSON() };
        await this.locations.add(IdOwner, itm)
        return await this.readLoc({ IdOwner, id });
    }

    async removeLoc({ id, IdOwner }: LocID & { IdOwner: string }): Promise<boolean> {
        return await this.loccob.remove(IdOwner, { id });
    }

    async addRec(mdl: RecRequest<RecPostRequest>): Promise<RecGetResponse> {

        const own = owners.find(f => f.id === mdl.IdOwner)

        if (!own) {
            throw new NotFoundException(MESSAGES.Errors.defaults.NOT_FOUNT('OWNER'));
        }

        const ispb = (own.ISPB || own.id.replace(/\W/g, '')).substring(0, 8);
        const data = new Date().toJSON().replace(/\D/g, '').substring(0, 8);
        const sufixo = randomUUID().replace(/\-/g, '').substring(0, 11);
        const idRec = `R${mdl.data.politicaRetentativa === PoliticaRetentativa.NaoPermite ? 'N' : 'R'}${ispb}${data}${sufixo}`;

        const itm: RecGetResponse = { ...mdl.data, idRec, status: StatusRec.Criada, atualizacao: [{ status: StatusRec.Criada, data: new Date().toJSON() }] };
        return await this.rec.add(mdl.IdOwner, itm);
    }

    async readRec({ IdOwner, idRec }: { IdOwner: string, idRec: string }): Promise<RecGetResponse> {
        return await this.rec.read(IdOwner, { idRec });
    }

    async listRec(filter: RecGetFilter & { IdOwner: string }) {
        const documento = filter.cpf || filter.cnpj;
        const recs: RecGetResponse[] = (await this.rec.list(filter.IdOwner)).filter((f: RecGetResponse) =>
            this.inPeriod(f.atualizacao?.[0]?.data, filter) &&
            (!filter.status || f.status === filter.status) &&
            (!documento || f.vinculo?.devedor?.cpf === documento || f.vinculo?.devedor?.cnpj === documento)
        );

        const { parametros, items } = this.paginate(filter, recs);
        return { parametros, recs: items };
    }

    async editRec({ IdOwner, idRec, data }: RecRequest<RecPatchRequest> & { idRec: string }): Promise<RecGetResponse> {
        const curr: RecGetResponse = await this.rec.read(IdOwner, { idRec });
        if (!curr) {
            return undefined;
        }

        if ([StatusRec.Cancelada, StatusRec.Rejeitada, StatusRec.Expirada].includes(curr.status)) {
            throw new BadRequestException(`A recorrência com status ${curr.status} não pode ser alterada.`);
        }

        const atualizacao = data.status && data.status !== curr.status
            ? [...(curr.atualizacao || []), { status: data.status, data: new Date().toJSON() }]
            : curr.atualizacao;

        return await this.rec.patch(IdOwner, { idRec }, {
            ...(data.status ? { status: data.status } : {}),
            ...(data.valor ? { valor: { ...curr.valor, ...data.valor } } : {}),
            ...(data.ativacao ? { ativacao: data.ativacao } : {}),
            atualizacao
        });
    }
}
