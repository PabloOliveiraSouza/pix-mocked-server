import { Body, Controller, Get, Headers, Param, Patch, Put, Query, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PSP } from '../core/app/psp';
import { HttpInterceptor } from '../http.interceptor';
import { CobVGetFilter, CobVPatchRequest, CobVPutRequest } from '../core/app/models/cobv';
import { PixRequest, Situacao } from '../core/app/models';
import { TxidPipe } from '../validators/txid.pipe';

const TXID_PARAM = { name: 'txid', description: 'Identificador da transação (^[a-zA-Z0-9]{26,35}$)', example: '7978c0c97ea847e78e8849634473c1f1' };

@ApiTags('CobV')
@ApiBearerAuth('access-token')
@Controller("cobv")
@UseInterceptors(HttpInterceptor)
export class CobVController {
  constructor(private readonly pspService: PSP) { }

  @Put(":txid")
  @ApiOperation({ summary: 'Criar cobrança com vencimento' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança com vencimento criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async create(@Body() data: CobVPutRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobVPutRequest> = { IdOwner, txid, data }
    return await this.pspService.addCobV(itm);
  }

  @Get(":txid")
  @ApiOperation({ summary: 'Consultar cobrança com vencimento' })
  @ApiParam(TXID_PARAM)
  @ApiQuery({ name: 'revisao', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Dados da cobrança com vencimento' })
  @ApiResponse({ status: 400, description: 'txid inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  async read(@Param("txid", TxidPipe) txid: string, @Headers() headers, @Query() qry?) {
    const IdOwner = headers["IdOwner"];
    const itm = await this.pspService.readCobV({ IdOwner, txid }, qry?.revisao);
    return itm;
  }

  @Get()
  @ApiOperation({ summary: 'Consultar lista de cobranças com vencimento' })
  @ApiQuery({ name: 'inicio', required: true, type: String })
  @ApiQuery({ name: 'fim', required: true, type: String })
  @ApiQuery({ name: 'cpf', required: false, type: String })
  @ApiQuery({ name: 'cnpj', required: false, type: String })
  @ApiQuery({ name: 'locationPresente', required: false, type: Boolean })
  @ApiQuery({ name: 'status', required: false, enum: Situacao })
  @ApiResponse({ status: 200, description: 'Lista de cobranças com vencimento' })
  list(@Headers() headers, @Query() qry: CobVGetFilter) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.listCobV({ ...qry, IdOwner });
  }

  @Patch(":txid")
  @ApiOperation({ summary: 'Revisar cobrança com vencimento', description: 'Para remover a cobrança, envie status REMOVIDA_PELO_USUARIO_RECEBEDOR.' })
  @ApiParam(TXID_PARAM)
  @ApiResponse({ status: 200, description: 'Cobrança com vencimento revisada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 404, description: 'Cobrança não encontrada' })
  edit(@Body() data: CobVPatchRequest, @Param("txid", TxidPipe) txid: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: PixRequest<CobVPatchRequest> = { IdOwner, txid, data }
    return this.pspService.editCobV(itm);
  }
}
