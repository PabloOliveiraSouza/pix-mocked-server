import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PSP } from '../core/app/psp';
import { HttpInterceptor } from '../http.interceptor';
import { CobGetFilter, CobPatchRequest, CobPutRequest } from '../core/app/models/cob';
import { PixRequest, Situacao } from '../core/app/models';
import { randomUUID } from 'crypto';
import { TxidPipe } from '../validators/txid.pipe';

const TXID_PARAM = { name: 'txid', description: 'Identificador da transação (^[a-zA-Z0-9]{26,35}$)', example: '7978c0c97ea847e78e8849634473c1f1' };

@ApiTags('Cob')
@ApiBearerAuth('access-token')
@Controller("cob")
@UseInterceptors(HttpInterceptor)
export class CobController {
  constructor(private readonly pspService: PSP) { }

  @Put(":txid")
  @ApiOperation({ summary: 'Criar cobrança imediata informando o txid' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança imediata criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async add(@Body() data: CobPutRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCob(itm);
  }

  @Post()
  @ApiOperation({ summary: 'Criar cobrança imediata (txid gerado pelo PSP)' })
  @ApiResponse({ status: 201, description: 'Cobrança imediata criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async create(@Body() data: CobPutRequest, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const txid: string = randomUUID().replace(/\-/g, '')
    const itm: PixRequest<CobPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCob(itm);
  }

  @Get(":txid")
  @ApiOperation({ summary: 'Consultar cobrança imediata' })
  @ApiParam(TXID_PARAM)
  @ApiQuery({ name: 'revisao', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dados da cobrança imediata' })
  @ApiResponse({ status: 400, description: 'txid inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  async read(@Param("txid", TxidPipe) txid: string, @Headers() headers, @Query() qry?) {
    const IdOwner = headers["IdOwner"];
    const itm = await this.pspService.readCob({ IdOwner, txid }, qry?.revisao);
    return itm;
  }

  @Get()
  @ApiOperation({ summary: 'Consultar lista de cobranças imediatas' })
  @ApiQuery({ name: 'inicio', required: true, type: String })
  @ApiQuery({ name: 'fim', required: true, type: String })
  @ApiQuery({ name: 'cpf', required: false, type: String })
  @ApiQuery({ name: 'cnpj', required: false, type: String })
  @ApiQuery({ name: 'locationPresente', required: false, type: Boolean })
  @ApiQuery({ name: 'status', required: false, enum: Situacao })
  @ApiResponse({ status: 200, description: 'Lista de cobranças imediatas' })
  list(@Headers() headers, @Query() qry: CobGetFilter) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.listCob({ ...qry, IdOwner });
  }

  @Patch(":txid")
  @ApiOperation({ summary: 'Revisar cobrança imediata', description: 'Para remover a cobrança, envie status REMOVIDA_PELO_USUARIO_RECEBEDOR.' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança imediata revisada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  edit(@Body() data: CobPatchRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobPatchRequest> = { IdOwner, txid, data }
    return this.pspService.editCob(itm);
  }
}
