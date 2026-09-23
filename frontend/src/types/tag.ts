/**
 * A Room's label for classifying and filtering Documents, with an optional
 * category (e.g. "Tipo").
 */
export interface Tag {
  id: string;
  name: string;
  category: string | null;
}
