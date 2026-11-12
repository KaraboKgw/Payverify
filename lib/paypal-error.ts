/**
 * PayPal structured error parsing.
 *
 * PayPal REST APIs return JSON error bodies of the form:
 *   {
 *     "name": "UNPROCESSABLE_ENTITY",
 *     "message": "The requested action could not be performed...",
 *     "details": [
 *       { "issue": "INSTRUMENT_DECLINED", "description": "..." }
 *     ],
 *     "debug_id": "abc123"
 *   }
 *
 * This module parses that structure and maps the `name` + `issue` values
 * documented in the Python SDK Orders/Payments endpoint reference to
 * user-facing messages and HTTP status codes for our own API responses.
 */

// ---------------------------------------------------------------------------
// PayPal error body shape (Orders v2 / Payments v2)
// ---------------------------------------------------------------------------
export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue: string;
  description?: string;
}

export interface PayPalErrorBody {
  name: string;
  message: string;
  debug_id?: string;
  details?: PayPalErrorDetail[];
  links?: { href: string; rel: string; method: string }[];
}

// ---------------------------------------------------------------------------
// Issue codes documented in the SDK for capture-order errors
// Source: Python SDK Orders → Errors → "Capture order" table
// ---------------------------------------------------------------------------
const CAPTURE_ISSUE_MESSAGES: Record<string, string> = {
  INSTRUMENT_DECLINED:
    "The payment instrument was declined. Redirect the payer to select another payment method.",
  ORDER_NOT_APPROVED:
    "The payer has not yet approved this order. Complete PayPal approval before capturing.",
  ORDER_ALREADY_CAPTURED:
    "This order has already been captured. Only one capture per order is allowed.",
  DUPLICATE_INVOICE_ID:
    "Duplicate invoice ID detected. Avoid retrying with the same order ID.",
  REDIRECT_PAYER_FOR_ALTERNATE_FUNDING:
    "Transaction failed. Redirect the payer to select another funding source.",
  PAYER_ACCOUNT_LOCKED_OR_CLOSED:
    "The payer's account cannot be used for this transaction.",
  PAYER_ACCOUNT_RESTRICTED:
    "The payer's account is restricted and cannot complete this transaction.",
  PAYER_CANNOT_PAY:
    "The payer cannot pay for this transaction. Contact the payer for alternatives.",
  TRANSACTION_LIMIT_EXCEEDED:
    "Total payment amount exceeded the transaction limit.",
  TRANSACTION_RECEIVING_LIMIT_EXCEEDED:
    "The transaction exceeds the receiver's receiving limit.",
  TRANSACTION_REFUSED:
    "The transaction was refused. Please try again.",
  PAYEE_BLOCKED_TRANSACTION:
    "The seller's fraud protection settings blocked this transaction.",
  COMPLIANCE_VIOLATION:
    "The transaction was declined due to a compliance violation.",
  CARD_EXPIRED:
    "The card provided is expired. Use a card with a future expiry date.",
  CARD_CLOSED:
    "The card is closed with the issuer. Use a different card.",
  MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED:
    "Maximum payment attempts exceeded. Please try again later.",
  NOT_ENABLED_FOR_CARD_PROCESSING:
    "This merchant account is not set up for card processing. Contact PayPal support.",
  AUTH_CAPTURE_NOT_ENABLED:
    "Authorization and capture is not enabled for this merchant account.",
  CONSENT_NEEDED:
    "Payee consent is required before this transaction can be processed.",
};

// Issue codes documented for create-order errors
const CREATE_ISSUE_MESSAGES: Record<string, string> = {
  AMOUNT_MISMATCH:
    "Amount mismatch — should equal item_total + tax_total + shipping + handling.",
  CANNOT_BE_ZERO_OR_NEGATIVE:
    "Amount must be greater than zero.",
  INVALID_CURRENCY_CODE:
    "Currency code is invalid or not currently supported.",
  PAYEE_ACCOUNT_LOCKED_OR_CLOSED:
    "The merchant account is locked or closed.",
  PAYEE_ACCOUNT_RESTRICTED:
    "The merchant account is restricted.",
  PAYMENT_SOURCE_DECLINED_BY_PROCESSOR:
    "The payment source was declined by the processor. Try a different payment source.",
  PAYMENT_SOURCE_INFO_CANNOT_BE_VERIFIED:
    "Payment source information could not be verified. Try a different payment source.",
  MAX_VALUE_EXCEEDED:
    "Payment amount exceeds the maximum allowed value of 9,999,999.99.",
  DUPLICATE_REFERENCE_ID:
    "reference_id must be unique across purchase units.",
  CARD_EXPIRED:
    "The payment card provided is expired.",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to parse a PayPal error response body as JSON.
 * Falls back to a plain-text error if JSON parsing fails.
 */
export async function parsePayPalError(response: Response): Promise<{
  errorBody: PayPalErrorBody | null;
  rawText: string;
}> {
  const rawText = await response.text();
  try {
    const errorBody: PayPalErrorBody = JSON.parse(rawText);
    return { errorBody, rawText };
  } catch {
    return { errorBody: null, rawText };
  }
}

/**
 * Translate a parsed PayPal error body into a user-facing message.
 * Prefers the most specific `details[].issue` message, falls back to
 * the top-level `name`, then to a generic fallback.
 */
export function humanisePayPalError(
  errorBody: PayPalErrorBody | null,
  issueMap: Record<string, string> = CAPTURE_ISSUE_MESSAGES
): {
  userMessage: string;
  issueCode: string | null;
  debugId: string | null;
  isDeclined: boolean;
} {
  if (!errorBody) {
    return {
      userMessage: "An unexpected error occurred. Please try again.",
      issueCode: null,
      debugId: null,
      isDeclined: false,
    };
  }

  const { name, message, debug_id, details } = errorBody;
  const debugId = debug_id ?? null;

  // Walk the details array looking for a known issue code
  for (const detail of details ?? []) {
    const knownMsg = issueMap[detail.issue] ?? CAPTURE_ISSUE_MESSAGES[detail.issue];
    if (knownMsg) {
      return {
        userMessage: knownMsg,
        issueCode: detail.issue,
        debugId,
        isDeclined:
          detail.issue === "INSTRUMENT_DECLINED" ||
          detail.issue === "REDIRECT_PAYER_FOR_ALTERNATE_FUNDING",
      };
    }
  }

  // Fall back to the top-level name
  const nameMap: Record<string, string> = {
    UNPROCESSABLE_ENTITY:
      "The action could not be completed. Check your payment details and try again.",
    INVALID_REQUEST:
      "The request was invalid. Check the order details and try again.",
    NOT_AUTHORIZED:
      "You do not have permission to perform this action.",
    RESOURCE_NOT_FOUND:
      "The order was not found. It may have expired.",
    AUTHENTICATION_FAILURE:
      "Authentication failed. Check your PayPal credentials.",
    INTERNAL_SERVER_ERROR:
      "PayPal encountered an internal error. Please try again in a moment.",
  };

  return {
    userMessage: nameMap[name] ?? message ?? "An unexpected PayPal error occurred.",
    issueCode: name ?? null,
    debugId,
    isDeclined: false,
  };
}

export { CAPTURE_ISSUE_MESSAGES, CREATE_ISSUE_MESSAGES };
