import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseInterceptors } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RecGetFilter, RecPatchRequest, RecPostRequest, RecRequest, StatusRec } from "../core/app/models/rec";
import { PSP } from "../core/app/psp";
import { HttpInterceptor } from "../http.interceptor";

const IDREC_PARAM = { name: 'idRec', description: 'Identificador da recorrência', example: 'RN0d9094da20301010a1b2c3d4e5f' };

@ApiTags('Rec')
@ApiBearerAuth('access-token')
@Controller("rec")
@UseInterceptors(HttpInterceptor)
export class RecController {
  constructor(private readonly pspService: PSP) { }

  @Post()
  @ApiOperation({ summary: 'Criar recorrência' })
  @ApiResponse({ status: 201, description: 'Recorrência criada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido' })
  @ApiResponse({ status: 401, description: 'Access Token inválido' })
  async create(@Body() data: RecPostRequest, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    const itm: RecRequest<RecPostRequest> = { IdOwner, data }
    return await this.pspService.addRec(itm);
  }

  @Get(":idRec")
  @ApiOperation({ summary: 'Consultar recorrência' })
  @ApiParam(IDREC_PARAM)
  @ApiResponse({ status: 200, description: 'Dados da recorrência' })
  @ApiResponse({ status: 404, description: 'Recorrência não encontrada' })
  async read(@Param("idRec") idRec: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    return await this.pspService.readRec({ IdOwner, idRec });
  }

  @Get()
  @ApiOperation({ summary: 'Consultar lista de recorrências' })
  @ApiQuery({ name: 'inicio', required: true, type: String })
  @ApiQuery({ name: 'fim', required: true, type: String })
  @ApiQuery({ name: 'cpf', required: false, type: String })
  @ApiQuery({ name: 'cnpj', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: StatusRec })
  @ApiResponse({ status: 200, description: 'Lista de recorrências' })
  list(@Headers() headers, @Query() qry: RecGetFilter) {
    const IdOwner = headers["IdOwner"];
    return this.pspService.listRec({ ...qry, IdOwner });
  }

  @Patch(":idRec")
  @ApiOperation({ summary: 'Revisar recorrência', description: 'Permite alterar status (APROVADA, REJEITADA, CANCELADA), valor e ativacao.' })
  @ApiParam(IDREC_PARAM)
  @ApiResponse({ status: 200, description: 'Recorrência revisada' })
  @ApiResponse({ status: 400, description: 'Requisição com formato inválido ou recorrência em status final' })
  @ApiResponse({ status: 404, description: 'Recorrência não encontrada' })
  async edit(@Body() data: RecPatchRequest, @Param("idRec") idRec: string, @Headers() headers) {
    const IdOwner = headers["IdOwner"];
    return await this.pspService.editRec({ IdOwner, idRec, data });
  }
}
