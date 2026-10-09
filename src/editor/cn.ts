/** Join truthy class names. */
export const cn = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
