// Prints a fresh ES256 private key as a JWK, for the OAUTH_PRIVATE_KEY secret in production:
//   fly secrets set OAUTH_PRIVATE_KEY="$(bun run gen-key)"
import { JoseKey } from '@atproto/jwk-jose';

const key = await JoseKey.generate(['ES256'], 'manalath-1');
console.log(JSON.stringify(key.privateJwk));
