import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

export const TXID_PATTERN = /^[a-zA-Z0-9]{26,35}$/;

@Injectable()
export class TxidPipe implements PipeTransform<string, string> {
    transform(value: string): string {
        if (typeof value !== 'string' || !TXID_PATTERN.test(value)) {
            throw new BadRequestException({ txid: 'O campo $$ não respeita o schema.' });
        }
        return value;
    }
}
