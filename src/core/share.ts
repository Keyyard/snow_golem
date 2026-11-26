import { deflateSync } from 'node:zlib';
import { Json } from './util';

/** Same encoding as Snowstorm's share.js: base64(zlib(JSON)). */
export function snowstormShareLink(particle: Json, texturePng?: Buffer): { url: string; length: number } {
	const url = new URL('https://snowstorm.app/');
	url.searchParams.set('loadParticle', deflateSync(Buffer.from(JSON.stringify(particle), 'utf8'), { level: 9 }).toString('base64'));
	if (texturePng) url.searchParams.set('loadParticleTexture', deflateSync(texturePng, { level: 9 }).toString('base64'));
	return { url: url.href, length: url.href.length };
}
