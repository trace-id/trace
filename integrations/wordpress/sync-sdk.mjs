// Copies the PHP SDK into the plugin so it works when installed on its own. Run after changing sdks/php/src.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const src = join(here, '../../sdks/php/src');
const dst = join(here, 'trace-device/lib');
mkdirSync(dst, { recursive: true });
for (const f of ['Trace.php', 'Guard.php']) copyFileSync(join(src, f), join(dst, f));
console.log('copied Trace.php and Guard.php into trace-device/lib');
