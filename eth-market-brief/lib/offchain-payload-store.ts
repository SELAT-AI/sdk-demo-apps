export type OffchainPaymentPayload = {
  id: string;
  capturedAt: string;
  targetUrl: string;
  paidRequestUrl: string;
  endpointId?: string;
  endpointName?: string;
  preferProtocol?: string;
  quoteId?: string;
  paymentSignature: string;
  paymentSignatureDigest?: string;
  decodedPayload: unknown;
  chain?: string;
  signerAddress?: string;
};

const MAX_RECORDS = 30;
const records: OffchainPaymentPayload[] = [];

export function recordOffchainPaymentPayload(record: OffchainPaymentPayload) {
  records.unshift(record);

  if (records.length > MAX_RECORDS) {
    records.length = MAX_RECORDS;
  }

  return record;
}

export function listOffchainPaymentPayloads() {
  return [...records];
}
