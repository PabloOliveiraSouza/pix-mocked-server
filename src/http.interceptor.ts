import { CallHandler, ExecutionContext, Injectable, NestInterceptor, HttpException, UnauthorizedException, InternalServerErrorException, BadRequestException, NotFoundException } from "@nestjs/common";
import { catchError, Observable, tap } from "rxjs";
import { owners } from './data/db.json'

type Violacao = { razao: string, propriedade: string };

@Injectable()
export class HttpInterceptor implements NestInterceptor {


    private handleError = (type: string, title: string, detail: string, status: number, violacoes: Violacao[]) => (
        {
            type,
            title,
            status,
            detail,
            violacoes
        }
    )



    private ServerErrorTypes = {
        400: (prefix: string, detail: string, violacoes: Violacao[]) => (this.handleError(`https://pix.bcb.gov.br/api/v2/error/${prefix}OperacaoInvalida`, 'Payload Inválido', detail, 400, violacoes)),
        401: () => this.handleError("https://pix.bcb.gov.br/api/v2/error/AcessoNegado", "Acesso Negado", "Access Token inválido.", 401, []),
        403: (detail: string, violacoes: Violacao[]) => (this.handleError(`https://pix.bcb.gov.br/api/v2/error/AcessoNegado`, `Acesso Negado`, detail, 403, violacoes)),
        404: () => (this.handleError(`https://pix.bcb.gov.br/api/v2/error/NaoEncontrado`, `Não Encontrado`, 'Entidade não encontrada.', 404, [])),
        500: () => (this.handleError(`https://pix.bcb.gov.br/api/v2/error/ErroInternoDoServidor`, 'Erro Interno do Servidor', 'Condição inesperada ao processar requisição.', 500, [])),
        503: () => (this.handleError(`https://pix.bcb.gov.br/api/v2/error/ServicoIndisponivel`, 'Serviço Indisponível', `Serviço não está disponível no momento. Serviço solicitado pode estar em manutenção ou fora da janela de funcionamento.`, 503, [])),
    }

    //PREFIXO DO TIPO DE ERRO E DETALHE PADRÃO DE SCHEMA POR ENDPOINT
    private endpoints: { [endpoint: string]: [string, string] } = {
        'cob': ['Cob', "A cobrança não respeita o schema."],
        'cobv': ['CobV', "A cobrança não respeita o schema."],
        'cobr': ['CobR', "A cobrança não respeita o schema."],
        'loc': ['Location', "O Location não respeita o schema."],
        'rec': ['Rec', "A recorrência não respeita o schema."],
    }

    //ACEITA "Authorization: Bearer <token>" E, POR COMPATIBILIDADE, "mocked-token: <token>"
    private extractToken(headers: any): string | undefined {
        const [scheme, bearer] = (headers['authorization'] || '').split(' ');
        if (scheme?.toLowerCase() === 'bearer' && bearer) {
            return bearer;
        }
        return headers['mocked-token'];
    }

    private badRequest(err: HttpException, endpoint: string) {
        const [prefix, schemaDetail] = this.endpoints[endpoint] || ['', 'A requisição não respeita o schema.'];
        const resp: any = err.getResponse();

        //ERRO DE NEGÓCIO: BadRequestException('mensagem')
        if (typeof resp === 'string' || typeof resp?.message === 'string') {
            return this.ServerErrorTypes[400](prefix, typeof resp === 'string' ? resp : resp.message, []);
        }

        //ValidationPipe SEM exceptionFactory: { message: string[] }
        if (Array.isArray(resp?.message)) {
            const violacoes = resp.message.map((razao: string) => ({ propriedade: endpoint, razao }));
            return this.ServerErrorTypes[400](prefix, schemaDetail, violacoes);
        }

        //ERROS DE SCHEMA: { campo: 'mensagem com $$' }
        const violacoes = Object.keys(resp || {}).map((key: string) => ({ propriedade: `${endpoint}.${key}`, razao: `${resp[key]}`.replace('$$', `${endpoint}.${key}`) }));
        return this.ServerErrorTypes[400](prefix, schemaDetail, violacoes);
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<void> {
        const request = context.switchToHttp().getRequest();
        const token = this.extractToken(request.headers);

        const own = token ? owners.find(f => f.token === token) : undefined;

        if (own) {
            request.headers['IdOwner'] = own.id;

            return next.handle().pipe(
                tap((res) => {
                    if ((request.method === 'GET' || request.method === 'PATCH' || request.method === 'DELETE') && !res) {
                        throw new NotFoundException();
                    }
                    else {    
                        return res;
                    }
                }),
                catchError((err: HttpException): Observable<any> => {
                    const status = err.getStatus?.() || 500;
                    const endpoint = `${request['url']}`.split('?')[0].split('/')[1];

                    if (status === 400) {
                        throw new BadRequestException(this.badRequest(err, endpoint));
                    }
                    if (status === 404) {
                        throw new NotFoundException(this.ServerErrorTypes[404]());
                    }
                    if (status >= 500 || !(err instanceof HttpException)) {
                        console.log(err);
                        throw new InternalServerErrorException(this.ServerErrorTypes[500]());
                    }
                    throw err;
                })
            );
        }
        else {
            return new Observable<any>((subs) => {

                throw new UnauthorizedException(this.ServerErrorTypes[401]())
            });

        }
    }
}
