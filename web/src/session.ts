// Session helpers — shareable room codes + invite links.

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no ambiguous chars

export function genRoomCode(): string {
  const arr =
    typeof crypto !== "undefined" && crypto.getRandomValues
      ? Array.from(crypto.getRandomValues(new Uint32Array(6)))
      : Array.from({ length: 6 }, () => Math.floor(Math.random() * 1e9));
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[arr[i] % CODE_ALPHABET.length];
  return s;
}

export function inviteLink(room: string): string {
  return `${window.location.origin}/?room=${encodeURIComponent(room)}`;
}
