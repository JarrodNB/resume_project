/**
 * Description: The product name, and localStorage keys derived from it.
 * Index:
 *   - PRODUCT_NAME: name shown in the app
 *   - productStorageKey: localStorage key prefixed with the product name
 */

/** Name shown in the header, auth pages, and document title. */
export const PRODUCT_NAME = 'Careerdrafter'

/** localStorage key namespaced to this product, e.g. `careerdrafter.authToken`. */
export function productStorageKey(name: string): string {
  return `${PRODUCT_NAME.toLowerCase()}.${name}`
}
