import { BadRequestException, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { randomUUID } from "crypto";
import * as request from 'supertest';
import { AppModule } from "../src/app.module";
import { AuthModule } from "../src/auth.module";
import { MemoryDB } from "../src/libs/fakedb";
import { addDays, errorFormatter, flatDate } from "../src/libs/utils";
import { PeriodicidadeRecorrencia, PoliticaRetentativa, RecPostRequest } from "../src/core/app/models/rec";
import { gerarCPF } from "../src/libs/documentos";
import { correntistas } from '../src/data/db.json'
import { TipoConta } from "../src/core/app/models";

const pipe = () => new ValidationPipe({
    transform: true,
    skipMissingProperties: true,
    exceptionFactory: (errors) => { throw new BadRequestException(errorFormatter(errors)) }
});

const newTxid = () => randomUUID().replace(/\-/g, '');

describe('Gap Analysis', () => {
    let app: INestApplication;
    let auth: INestApplication;

    beforeAll(async () => {
        const cst = MemoryDB.create("CORRENTISTAS", ['chave', 'cpfcnpj']);
        MemoryDB.create("COB", ['txid']);
        MemoryDB.create("COBR", ['txid']);
        MemoryDB.create("COB_HIST", ['id']);
        MemoryDB.create("LOCATIONS", ['id', 'uuid']);
        MemoryDB.create("LOC_COB", ['id', 'txid']);
        MemoryDB.create("REC", ['idRec']);
        await Promise.all(correntistas.map(c => cst.add('DEV', c)));

        app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
        app.useGlobalPipes(pipe());
        await app.init();

        auth = (await Test.createTestingModule({ imports: [AuthModule] }).compile()).createNestApplication();
        auth.useGlobalPipes(pipe());
        await auth.init();
    });

    afterAll(async () => {
        await app.close();
        await auth.close();
    });

    const api = () => request(app.getHttpServer());

    const rec = (politicaRetentativa = PoliticaRetentativa.NaoPermite): RecPostRequest => ({
        vinculo: {
            objeto: "Assinatura",
            contrato: newTxid(),
            devedor: { cep: "26083190", cidade: "Nova Iguaçu", logradouro: "Rua Gemeos", uf: "RJ", nome: "Teste da Silva", cpf: gerarCPF() }
        },
        ativacao: { dadosJornada: { txid: newTxid() } },
        calendario: { dataInicial: flatDate(new Date()).toJSON(), periodicidade: PeriodicidadeRecorrencia.Mensal },
        politicaRetentativa,
        recebedor: { cep: "26083190", cidade: "Nova Iguaçu", logradouro: "Rua Gemeos", uf: "RJ", nome: "Teste da Silva", cpf: gerarCPF() },
        valor: { valorRec: "1000.00" }
    });

    const createRec = async (politica?: PoliticaRetentativa) =>
        (await api().post('/rec').set("mocked-token", "123-abc").send(rec(politica)).expect(201)).body;

    const cobr = (idRec: string) => ({
        idRec,
        infoAdicional: "Mensalidade",
        calendario: { dataDeVencimento: addDays(flatDate(new Date()), 5).toJSON().substring(0, 10) },
        dadosDevedor: { cep: "26083190", cidade: "Nova Iguaçu", logradouro: "Rua Gemeos", uf: "RJ" },
        contaRecebedor: { agencia: "0001", conta: "123456", tipoConta: TipoConta.Corrente }
    });

    describe('AUTH', () => {
        it('grant_type inválido → 400 unsupported_grant_type', async () => await request(auth.getHttpServer())
            .post('/auth')
            .send({ grant_type: 'password', client_id: '123', client_secret: 'abc' })
            .expect(400)
            .expect(res => expect(res.body).toMatchObject({ error: 'unsupported_grant_type' })));

        it('credenciais inválidas → 401 invalid_client', async () => await request(auth.getHttpServer())
            .post('/auth')
            .send({ grant_type: 'client_credentials', client_id: '123', client_secret: 'xxx' })
            .expect(401)
            .expect(res => expect(res.body).toMatchObject({ error: 'invalid_client' })));

        it('retorna access_token', async () => await request(auth.getHttpServer())
            .post('/auth')
            .send({ grant_type: 'client_credentials', client_id: '123', client_secret: 'abc' })
            .expect(201)
            .expect(res => {
                expect(res.body).toMatchObject({ access_token: '123-abc', token_type: 'Bearer', expires_in: 300 });
                expect(res.body.accesstoken).toBeUndefined();
            }));

        it('Authorization: Bearer é aceito', async () => await api().get('/rec').set('Authorization', 'Bearer 123-abc').query({ inicio: addDays(new Date(), -1).toJSON(), fim: addDays(new Date(), 1).toJSON() }).expect(200));
        it('Authorization: Bearer inválido → 401', async () => await api().get('/rec').set('Authorization', 'Bearer xpto').expect(401));
    });

    describe('TXID', () => {
        it('GET /cob/:txid inválido → 400', async () => await api().get('/cob/abc').set("mocked-token", "123-abc").expect(400)
            .expect(res => expect(res.body).toMatchObject({ status: 400, violacoes: [{ propriedade: 'cob.txid' }] })));
        it('PUT /cobv/:txid com hífen → 400', async () => await api().put(`/cobv/${randomUUID()}`).set("mocked-token", "123-abc").send({}).expect(400));
        it('PATCH /cobr/:txid > 35 → 400', async () => await api().patch(`/cobr/${''.padEnd(36, 'a')}`).set("mocked-token", "123-abc").send({}).expect(400));
        it('GET /cob/:txid válido inexistente → 404', async () => await api().get(`/cob/${newTxid()}`).set("mocked-token", "123-abc").expect(404));
    });

    describe('VALOR', () => {
        it('valor.original sem 2 casas decimais → 400', async () => await api().put(`/cob/${newTxid()}`).set("mocked-token", "123-abc")
            .send({ calendario: { expiracao: 3600 }, valor: { original: "10.5" }, chave: correntistas[0].chave })
            .expect(400)
            .expect(res => expect(res.body).toMatchObject({ violacoes: [{ propriedade: 'cob.valor.original' }] })));
    });

    describe('GET /cob?status', () => {
        it('filtra por status antes da paginação', async () => {
            const [ativa, removida] = [newTxid(), newTxid()];
            const payload = { calendario: { expiracao: 3600 }, valor: { original: "10.00" }, chave: correntistas[0].chave };

            await api().put(`/cob/${ativa}`).set("mocked-token", "123-abc").send(payload).expect(200);
            await api().put(`/cob/${removida}`).set("mocked-token", "123-abc").send(payload).expect(200);
            await api().patch(`/cob/${removida}`).set("mocked-token", "123-abc").send({ status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" }).expect(200);

            const periodo = { inicio: addDays(new Date(), -1).toJSON(), fim: addDays(new Date(), 1).toJSON() };

            const { body } = await api().get('/cob').set("mocked-token", "123-abc").query({ ...periodo, status: 'ATIVA' }).expect(200);
            expect(body.cobs.map(c => c.txid)).toContain(ativa);
            expect(body.cobs.map(c => c.txid)).not.toContain(removida);
            expect(body.cobs.every(c => c.status === 'ATIVA')).toBe(true);
            expect(body.parametros.paginacao.quantidadeTotalDeItens).toBe(body.cobs.length);

            const removidas = (await api().get('/cob').set("mocked-token", "123-abc").query({ ...periodo, status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }).expect(200)).body;
            expect(removidas.cobs.map(c => c.txid)).toEqual([removida]);
        });
    });

    describe('REC', () => {
        it('POST gera idRec sem espaços', async () => {
            const { idRec, status } = await createRec();
            expect(idRec).toMatch(/^R[NR][a-zA-Z0-9]{8}\d{8}[a-zA-Z0-9]{11}$/);
            expect(status).toBe('CRIADA');
        });

        it('GET /rec/:idRec', async () => {
            const { idRec } = await createRec();
            await api().get(`/rec/${idRec}`).set("mocked-token", "123-abc").expect(200)
                .expect(res => expect(res.body).toMatchObject({ idRec, status: 'CRIADA', valor: { valorRec: "1000.00" } }));
        });

        it('GET /rec/:idRec de outro owner → 404', async () => {
            const { idRec } = await createRec();
            await api().get(`/rec/${idRec}`).set("mocked-token", "456-def").expect(404);
        });

        it('GET /rec lista com filtro de status', async () => {
            const { idRec } = await createRec();
            const { body } = await api().get('/rec').set("mocked-token", "123-abc")
                .query({ inicio: addDays(new Date(), -1).toJSON(), fim: addDays(new Date(), 1).toJSON(), status: 'CRIADA' }).expect(200);
            expect(body.recs.map(r => r.idRec)).toContain(idRec);
            expect(body.recs.every(r => r.status === 'CRIADA')).toBe(true);
        });

        it('PATCH /rec/:idRec altera status e registra atualização', async () => {
            const { idRec } = await createRec();
            await api().patch(`/rec/${idRec}`).set("mocked-token", "123-abc").send({ status: 'APROVADA' }).expect(200)
                .expect(res => {
                    expect(res.body).toMatchObject({ idRec, status: 'APROVADA' });
                    expect(res.body.atualizacao.map(a => a.status)).toEqual(['CRIADA', 'APROVADA']);
                });
        });

        it('PATCH /rec/:idRec com status inválido → 400', async () => {
            const { idRec } = await createRec();
            await api().patch(`/rec/${idRec}`).set("mocked-token", "123-abc").send({ status: 'XPTO' }).expect(400);
        });

        it('PATCH /rec/:idRec inexistente → 404', async () => await api().patch(`/rec/${newTxid()}`).set("mocked-token", "123-abc").send({ status: 'APROVADA' }).expect(404));
    });

    describe('COBR', () => {
        it('PUT /cobr/:txid → 200 com schema CobR', async () => {
            const { idRec } = await createRec();
            const txid = newTxid();
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200)
                .expect(res => {
                    expect(res.body).toMatchObject({ txid, idRec, revisao: 0, status: 'CRIADA', valor: { original: "1000.00" }, politicaRetentativa: PoliticaRetentativa.NaoPermite, contaRecebedor: { agencia: "0001" } });
                    expect(res.body.criacao).toBeDefined();
                });
        });

        it('PUT /cobr/:txid com idRec inexistente → 400', async () => await api().put(`/cobr/${newTxid()}`).set("mocked-token", "123-abc").send(cobr('RN000000002026010100000000000')).expect(400));

        it('GET /cobr/:txid consulta na coleção COBR (isolada de COB)', async () => {
            const { idRec } = await createRec();
            const txid = newTxid();
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);

            await api().get(`/cobr/${txid}`).set("mocked-token", "123-abc").expect(200).expect(res => expect(res.body).toMatchObject({ txid, idRec }));
            await api().get(`/cob/${txid}`).set("mocked-token", "123-abc").expect(404);
            await api().get(`/cobr/${txid}`).set("mocked-token", "456-def").expect(404);
        });

        it('GET /cobr lista por idRec', async () => {
            const { idRec } = await createRec();
            const txid = newTxid();
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);
            const { body } = await api().get('/cobr').set("mocked-token", "123-abc")
                .query({ inicio: addDays(new Date(), -1).toJSON(), fim: addDays(new Date(), 1).toJSON(), idRec }).expect(200);
            expect(body.cobs.map(c => c.txid)).toEqual([txid]);
        });

        it('PATCH /cobr/:txid gera nova revisão', async () => {
            const { idRec } = await createRec();
            const txid = newTxid();
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);
            await api().patch(`/cobr/${txid}`).set("mocked-token", "123-abc").send({ infoAdicional: "Revisada" }).expect(200)
                .expect(res => expect(res.body).toMatchObject({ txid, revisao: 1, infoAdicional: "Revisada" }));
            await api().get(`/cobr/${txid}`).set("mocked-token", "123-abc").query({ revisao: 0 }).expect(200)
                .expect(res => expect(res.body).toMatchObject({ revisao: 0, infoAdicional: "Mensalidade" }));
        });

        it('PATCH /cobr/:txid status CANCELADA', async () => {
            const { idRec } = await createRec();
            const txid = newTxid();
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);
            await api().patch(`/cobr/${txid}`).set("mocked-token", "123-abc").send({ status: "CANCELADA" }).expect(200)
                .expect(res => expect(res.body).toMatchObject({ status: "CANCELADA" }));
        });

        it('POST /cobr/:txid/retentativa/:data usa a data da rota', async () => {
            const { idRec } = await createRec(PoliticaRetentativa.Permite);
            const txid = newTxid();
            const data = addDays(flatDate(new Date()), 6).toJSON().substring(0, 10);
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);
            await api().post(`/cobr/${txid}/retentativa/${data}`).set("mocked-token", "123-abc").expect(200)
                .expect(res => expect(res.body.tentativas).toEqual([expect.objectContaining({ tipo: 'RETENTATIVA', dataLiquidacao: data, status: 'SOLICITADA' })]));
        });

        it('POST /cobr/:txid/retentativa/:data sem permissão da recorrência → 400', async () => {
            const { idRec } = await createRec(PoliticaRetentativa.NaoPermite);
            const txid = newTxid();
            const data = addDays(flatDate(new Date()), 6).toJSON().substring(0, 10);
            await api().put(`/cobr/${txid}`).set("mocked-token", "123-abc").send(cobr(idRec)).expect(200);
            await api().post(`/cobr/${txid}/retentativa/${data}`).set("mocked-token", "123-abc").expect(400);
        });

        it('POST /cobr/:txid/retentativa/:data com data inválida → 400', async () => await api().post(`/cobr/${newTxid()}/retentativa/2024-13-45`).set("mocked-token", "123-abc").expect(400));
    });
});
