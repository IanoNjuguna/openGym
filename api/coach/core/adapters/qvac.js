/* QVAC by Tether, serving a model on the machine the owner already has.
 *
 * Identical wire shape to compatible.js, and deliberately so: `qvac serve --openai` mounts the
 * Chat Completions API and lists its own aliases at /v1/models, which is the same contract
 * Ollama and LM Studio answer to. What is different is only the starting point — the base URL
 * is preconfigured to QVAC's default port, the key is optional, and the provider carries
 * `local: true` so the long local timeout, the warmup and the consent copy all recognise it
 * without naming it.
 *
 * temperature 0 for the same reason it is 0 on `compatible`: a plan diff wants determinism, and
 * greedy decoding is what grammar-constrained sampling on a local server handles fastest.
 */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

export const qvacSpec = chatCompletionsSpec('qvac', { maxTokensField: 'max_tokens', temperature: 0, versionlessFallback: true });
export default httpAdapter(qvacSpec);
