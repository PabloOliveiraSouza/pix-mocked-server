import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PSP } from '../core/app/psp';
import { HttpInterceptor } from '../http.interceptor';
import { CobRGetFilter, CobRPatchRequest, CobRPutRequest, StatusCobR } from '../core/app/models/cobr';
import { PixRequest } from '../core/app/models';
import { randomUUID } from 'crypto';
import { TxidPipe } from '../validators/txid.pipe';

const TXID_PARAM = { name: 'txid', description: 'Identificador da transação (^[a-zA-Z0-9]{26,35}$)', example: '7978c0c97ea847e78e8849634473c1f1' };

@ApiTags('CobR')
@ApiBearerAuth('access-token')
@Controller("cobr")
@UseInterceptors(HttpInterceptor)
export class CobRController {
  constructor(private readonly pspService: PSP) { }

  @Put(":txid")
  @ApiOperation({ summary: 'Criar cobrança recorrente informando o txid', description: 'A cobrança é vinculada à recorrência informada em idRec.' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança recorrente criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido ou recorrência inexistente' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async add(@Body() data: CobRPutRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobRPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobR(itm);
  }

  @Post()
  @ApiOperation({ summary: 'Criar cobrança recorrente (txid gerado pelo PSP)' })
  @ApiResponse({ status: 201, description: 'Cobrança recorrente criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido ou recorrência inexistente' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async create(@Body() data: CobRPutRequest, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const txid: string = randomUUID().replace(/\-/g, '')
    const itm: PixRequest<CobRPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobR(itm);
  }

  @Post(":txid/retentativa/:data")
  @HttpCode(200)
  @ApiOperation({ summary: 'Solicitar retentativa de cobrança recorrente', description: 'Exige recorrência com politicaRetentativa PERMITE_3R_7D. Máximo de 3 retentativas, até 7 dias após o vencimento.' })
  @ApiParam(TXID_PARAM)
  @ApiParam({ name: 'data', description: 'Data da nova tentativa de liquidação (YYYY-MM-DD)', example: '2030-01-10' })
  @ApiResponse({ status: 200, description: 'Retentativa registrada' })
  @ApiResponse({ status: 400, description: 'Data inválida ou retentativa não permitida' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  async createRetentativa(@Param("txid", TxidPipe) txid: string, @Param("data") data: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    return await this.pspService.retentativaCobR({ IdOwner, txid }, data);
  }

  @Get(":txid")
  @ApiOperation({ summary: 'Consultar cobrança recorrente' })
  @ApiParam(TXID_PARAM)
  @ApiQuery({ name: 'revisao', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dados da cobrança recorrente' })
  @ApiResponse({ status: 400, description: 'txid inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  async read(@Param("txid", TxidPipe) txid: string, @Headers() headers, @Query() qry?) {
    const IdOwner = headers["IdOwner"];
    const itm = await this.pspService.readCobR({ IdOwner, txid }, qry?.revisao);
    return itm;
  }

  @Get()
  @ApiOperation({ summary: 'Consultar lista de cobranças recorrentes' })
  @ApiQuery({ name: 'inicio', required: true, type: String })
  @ApiQuery({ name: 'fim', required: true, type: String })
  @ApiQuery({ name: 'idRec', required: false, type: String })
  @ApiQuery({ name: 'cpf', required: false, type: String })
  @ApiQuery({ name: 'cnpj', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: StatusCobR })
  @ApiResponse({ status: 200, description: 'Lista de cobranças recorrentes' })
  list(@Headers() headers, @Query() qry: CobRGetFilter) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.listCobR({ ...qry, IdOwner });
  }

  @Patch(":txid")
  @ApiOperation({ summary: 'Revisar cobrança recorrente', description: 'Para cancelar a cobrança, envie status CANCELADA.' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança recorrente revisada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  edit(@Body() data: CobRPatchRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobRPatchRequest> = { IdOwner, txid, data }
    return this.pspService.editCobR(itm);
  }
}
