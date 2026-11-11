import { BadRequestException, Body, Controller, Post, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Auth } from "../core/auth/auth";
import { ValidateInput } from "./auth.models";

//ERROS NO FORMATO OAUTH2 (RFC 6749, seção 5.2), POIS ESTE É O TOKEN ENDPOINT DO MOCK
@ApiTags('Auth')
@Controller("auth")
export class AuthController {
    constructor(private readonly authService: Auth) { }

    @Post()
    @ApiOperation({ summary: 'Obter access token (OAuth2 client_credentials)' })
    @ApiResponse({ status: 201, description: 'Token emitido: { access_token, token_type, expires_in }' })
    @ApiResponse({ status: 400, description: '{ error: "unsupported_grant_type", error_description }' })
    @ApiResponse({ status: 401, description: '{ error: "invalid_client", error_description }' })
    async validate(@Body() credentials: ValidateInput): Promise<{ access_token: string, token_type: string, expires_in: number }> {
        if (credentials?.grant_type !== 'client_credentials') {
            throw new BadRequestException({ error: 'unsupported_grant_type', error_description: 'O grant_type informado não é suportado. Utilize client_credentials.' });
        }

        const access_token = await this.authService.validate(credentials.client_id, credentials.client_secret)
            .catch(() => { throw new UnauthorizedException({ error: 'invalid_client', error_description: 'Credenciais do cliente inválidas.' }) });

        return {
            access_token,
            token_type: 'Bearer',
            expires_in: 300 //5 min
        }
    }
}
