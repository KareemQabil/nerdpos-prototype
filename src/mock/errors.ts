import { errorsByCode } from './contracts';
import { errorsAr } from '../i18n/errors';

/** A refusal from the mock server. Status and English message come from contracts/errors.json. */
export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, details?: Record<string, unknown>, statusOverride?: number) {
    const def = errorsByCode.get(code);
    super(def?.safe_message ?? code);
    this.code = code;
    this.status = statusOverride ?? def?.http_status ?? 400;
    this.details = details;
  }
  toBody() {
    const def = errorsByCode.get(this.code);
    return {
      error: {
        code: this.code,
        message: def?.safe_message ?? this.message,
        messageAr: errorsAr[this.code] ?? null,
        retryable: def?.retryable ?? false,
        inContract: !!def,
        details: this.details ?? null,
      },
    };
  }
}

export const fail = (code: string, details?: Record<string, unknown>): never => {
  throw new ApiError(code, details);
};
