/**
 * A Room's label for classifying and filtering Documents, with an optional
 * category (e.g. "Tipo"). A non-null `mainPosition` makes it one of the Room's
 * Main Tags (spec 11): the Documents list groups by them, in ascending order.
 */
export interface Tag {
  id: string;
  name: string;
  category: string | null;
  mainPosition: number | null;
}

/** A Tag as the backend serializes it. */
export interface RawTag {
  id: string;
  name: string;
  category: string | null;
  main_position?: number | null;
}
