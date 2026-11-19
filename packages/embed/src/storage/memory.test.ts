import { storageContract } from './contract.js';
import { memoryStorage } from './memory.js';

storageContract('memory', async () => memoryStorage());
