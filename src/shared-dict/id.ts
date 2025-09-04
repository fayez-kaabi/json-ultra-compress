import crypto from 'crypto';

export function sharedDictId(dictJson: string): string {
  return crypto.createHash('sha256').update(dictJson).digest('hex');
}


