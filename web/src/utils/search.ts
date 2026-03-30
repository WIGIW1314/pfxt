import { match } from "pinyin-pro";

type SearchableValue = string | number | null | undefined;

function normalizeKeyword(keyword: string) {
  return keyword.trim().toLowerCase();
}

function compactKeyword(keyword: string) {
  return normalizeKeyword(keyword).replace(/\s+/g, "");
}

function toSearchText(value: SearchableValue) {
  if (value == null) return "";
  return String(value).trim();
}

export function matchesSearchKeyword(fields: SearchableValue[], keyword: string) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return true;

  const pinyinKeyword = compactKeyword(keyword);

  return fields.some((field) => {
    const text = toSearchText(field);
    if (!text) return false;

    const normalizedText = text.toLowerCase();
    if (normalizedText.includes(normalizedKeyword)) {
      return true;
    }

    return Boolean(
      match(text, pinyinKeyword, {
        precision: "first",
        lastPrecision: "start",
        space: "ignore",
        insensitive: true,
      }),
    );
  });
}
