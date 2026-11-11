import { IsDateString, IsIn, IsOptional, Matches, IsDefined, IsEnum, IsNotEmpty, IsNotEmptyObject, IsNumberString, MaxLength, ValidateNested } from "class-validator"
import { Pessoa, PixID } from "../models"
import { Type } from "class-transformer"
import { IsCNPJValid, IsCPFValid, MinStringNumber, NotPast } from "../../../validators/custom-validators"

export class Vinculo {
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @MaxLength(35, { message: 'O campo $$ não respeita o schema.' })
    objeto: string
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @MaxLength(35, { message: 'O campo $$ não respeita o schema.' })
    contrato: string
    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested()
    @Type(() => Pessoa)
    devedor: Pessoa
}

export enum PoliticaRetentativa {
    Permite = "PERMITE_3R_7D",
    NaoPermite = "NAO_PERMITE"
}

export class ValorRecebimento {
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @IsNumberString({}, { message: 'O campo $$ não respeita o schema.' })
    @Matches(/^\d{1,10}\.\d{2}$/, { message: 'O campo $$ não respeita o schema.' })
    @MinStringNumber(0.01, { message: 'O campo $$ é zero.' })
    valorRec: string
}

export enum PeriodicidadeRecorrencia {
    Semanal = "SEMANAL",
    Mensal = "MENSAL",
    Trimestral = "TRIMESTRAL",
    Semestral = "SEMESTRAL",
    Anual = "ANUAL"
}

export class CalendarioRecorrencia {
    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @IsDateString({}, { message: 'O campo $$ não respeita o schema.' })
    @NotPast({ message: 'O campo $$ é anterior à data de criação da cobrança.' })
    dataInicial: string

    @IsDateString({}, { message: 'O campo $$ não respeita o schema.' })
    @NotPast({ message: 'O campo $$ é anterior à data de criação da cobrança.' })
    dataFinal?: string

    @IsNotEmpty({ message: 'O campo $$ não respeita o schema.' })
    @IsEnum(PeriodicidadeRecorrencia, { message: 'O campo $$ não respeita o schema.' })
    periodicidade: PeriodicidadeRecorrencia
}

export class AtivacaoRecorrencia {
    @ValidateNested({})
    @Type(() => PixID)
    dadosJornada: PixID
}


export class RecPostRequest {
    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested({})
    @Type(() => Vinculo)
    vinculo: Vinculo

    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested({})
    @Type(() => CalendarioRecorrencia)
    calendario: CalendarioRecorrencia

    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested({})
    @Type(() => ValorRecebimento)
    valor: ValorRecebimento

    @IsNotEmpty()
    @IsEnum(PoliticaRetentativa, { message: 'O campo $$ não respeita o schema.' })
    politicaRetentativa: PoliticaRetentativa

    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested({})
    @Type(() => Pessoa)
    recebedor: Pessoa

    @IsDefined({ message: 'O objeto $$ não respeita o schema.' })
    @IsNotEmptyObject({ nullable: false }, { message: 'O objeto $$ não respeita o schema.' })
    @ValidateNested({})
    @Type(() => AtivacaoRecorrencia)
    ativacao: AtivacaoRecorrencia
}

export class RecRequest<T> {
    IdOwner: string
    data: T
}

export enum StatusRec {
    Criada = "CRIADA",
    Aprovada = "APROVADA",
    Rejeitada = "REJEITADA",
    Expirada = "EXPIRADA",
    Cancelada = "CANCELADA"
}

export class AtualizacaoRec {
    status: StatusRec
    data: string
}

export class RecGetResponse extends RecPostRequest {
    idRec: string
    status: StatusRec
    atualizacao: AtualizacaoRec[]
}

export class RecPatchRequest {
    @IsOptional()
    @IsIn([StatusRec.Aprovada, StatusRec.Rejeitada, StatusRec.Cancelada], { message: 'O campo $$ não respeita o schema.' })
    status?: StatusRec.Aprovada | StatusRec.Rejeitada | StatusRec.Cancelada

    @IsOptional()
    @ValidateNested({})
    @Type(() => ValorRecebimento)
    valor?: ValorRecebimento

    @IsOptional()
    @ValidateNested({})
    @Type(() => AtivacaoRecorrencia)
    ativacao?: AtivacaoRecorrencia
}

export class RecGetFilter {
    inicio: string
    fim: string
    @IsCPFValid({ message: 'O campo $$ não respeita o schema.' })
    cpf?: string
    @IsCNPJValid({ message: 'O campo $$ não respeita o schema.' })
    cnpj?: string
    status?: StatusRec
    paginacao?: { paginaAtual: number, itensPorPagina: number }
}