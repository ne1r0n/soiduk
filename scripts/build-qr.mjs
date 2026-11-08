// Writes src/qr.svg: a QR code for APP_URL (src/config.ts), shown in the settings so that
// someone next to you can scan it and open the app. Run `npm run qr` after changing APP_URL.

import { writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { APP_URL } from '../src/config.ts';

const svg = await QRCode.toString(APP_URL, {
	type: 'svg',
	errorCorrectionLevel: 'M',
	margin: 2, // the quiet zone scanners need, drawn on the white background
	color: { dark: '#000000', light: '#ffffff' },
});
await writeFile(new URL('../src/qr.svg', import.meta.url), `${svg}\n`);
console.log(`${APP_URL} -> src/qr.svg (${svg.length} bytes)`);
