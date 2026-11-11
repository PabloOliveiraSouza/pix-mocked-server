import { IsIn, IsNotEmpty, Matches, IsNotEmptyObject, IsNumberString, MaxLength, ValidateNested } from "class-validator"
import { Chave, ICriacao, Expiracao, IInfoAdicional, Pessoa, PixID, ModalidadeAlteracao, Situacao, PixRevisao, Vencimento, DadosPessoa, DadosConta } from "../models"
import { Type } from "class-transformer"
import { IntersectionType } from '@nestjs/swagger';
import { IsCNPJValid, IsCPFValid, IsDICTExists, IsDICTValid, MinStringNumber } from "../../../validators/custom-validators";
import { LocID, LocGetRequest } from "./loc";
import { PoliticaRetentativa } from "./rec";

/** 	
Todos os campos que indicam valores monetários obedecem ao pattern \d{1,10}.\d{2}. O separador decimal é o caractere ponto. Não é aplicável utilizar separador de milhar. Exemplos de valores aderentes ao padrão: “1.00”, “123.99”, “123456789.23" */
export class Valor {
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @IsNumberString({}, { message: 'O campo $$ não respeita o schema.' })
    @Matches(/^\d{1,10}\.\d{2}$/, { message: 'O campo $$ não respeita o schema.' })
    @MinStringNumber(0.01, { message: 'O campo $$ é zero.' })
    original: string
}

export class Alteracao {
    /** Trata-se de um campo que determina se o valor final do documento pode ser alterado pelo pagador. Na ausência desse campo, assume-se que não se pode alterar o valor do documento de cobrança, ou seja, assume-se o valor 0. Se o campo estiver presente e com valor 1, então está determinado que o valor final da cobrança pode ter seu valor alterado pelo pagador. */
    modalidadeAlteracao?: ModalidadeAlteracao
}

export class Retirada {
    retirada?: any
}


export enum StatusCobR{
    Aprovada = "APROVADA",
    Ativa = "ATIVA",
    Cancelada = "CANCELADA",
    Concluida = "CONCLUIDA",
    Criada = "CRIADA",
    Expirada = "EXPIRADA",
    Rejeitada = "REJEITADA"
}

export enum TipoTentativaCobR {
    Agendamento = "AGENDAMENTO",
    Retentativa = "RETENTATIVA"
}

export class TentativaCobR {
    tipo: TipoTentativaCobR
    dataLiquidacao: string
    status: "SOLICITADA"
    criacao: string
}


export class CobRGetResponse implements PixID, PixRevisao {
    idRec: string
    txid: string
    revisao: number
    criacao: string
    infoAdicional: string
    calendario: Vencimento
    valor: Valor
    status: StatusCobR
    politicaRetentativa: PoliticaRetentativa
    dadosDevedor: DadosPessoa
    contaRecebedor: DadosConta
    tentativas: TentativaCobR[]
    loc: LocGetRequest
    location: string
}

export class CobRValor extends IntersectionType(Valor, Alteracao, Retirada)
{

}



export class CobRPutRequest {
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    idRec: string
    @MaxLength(140, { message: 'O campo $$ não respeita o schema.' })
    infoAdicional: string
    @ValidateNested({})
    @Type(() => Vencimento)
    calendario: Vencimento

    /** Quando ausente, assume o valor da recorrência (rec.valor.valorRec). */
    @ValidateNested({})
    @Type(() => Valor)
    valor?: Valor

    @ValidateNested({})
    @Type(() => DadosPessoa)
    dadosDevedor: DadosPessoa
    @ValidateNested({})
    @Type(() => DadosConta)
    contaRecebedor: DadosConta
}

export class CobRPatchRequest {
    @ValidateNested({})
    @Type(() => LocID)
    loc?: LocID
    @ValidateNested({})
    @Type(() => CobRValor)
    valor?: CobRValor
    @ValidateNested()
    @Type(() => Vencimento)
    calendario?: Vencimento
    @ValidateNested({})
    @Type(() => DadosPessoa)
    dadosDevedor?: DadosPessoa
    @MaxLength(140, { message: 'O campo $$ não respeita o schema.' })
    infoAdicional?: string
    @IsIn([StatusCobR.Cancelada], { message: 'O campo $$ não respeita o schema.' })
    status?: StatusCobR.Cancelada
}

export class CobRPatchResponse extends CobRGetResponse {

}


export class CobRPutResponse extends CobRGetResponse {

}

export interface ICobRPatchResponse extends CobRGetResponse {

}


export interface ICobRQueryRequest {
    inicio: string,
    fim: string,
    cpf?: string,
    cnpj?: string,
    locationPresente?: boolean,
    status: string,
    paginacao: {
        paginaAtual: number,
        itensPorPagina: number
    }
}

export interface ICobRQueryResponse {
    parametros: {
        inicio: string,
        fim: string,
        paginacao: {
            paginaAtual: number,
            itensPorPagina: number,
            quantidadeDePaginas: number,
            quantidadeTotalDeItens: number
        }
    },
    cobs: { $ref: string }[]
}

export class CobRGetFilter {
    inicio: string
    fim: string
    idRec?: string
    @IsCPFValid({ message: 'O campo $$ não respeita o schema.' })
    cpf?: string
    @IsCNPJValid({ message: 'O campo $$ não respeita o schema.' })
    cnpj?: string
    paginacao?: { paginaAtual: number, itensPorPagina: number }
    status?: StatusCobR
    locationPresente?: boolean
}