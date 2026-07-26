import { randomInt } from "crypto";

const CHARSET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"; // no 0/O/1/l/I — avoids handoff transcription errors

// Random 10-character temp password for owner-created branch manager
// accounts (comanager-auth: "Owner generates a random 10-character temp
// password"). Handed to the owner in a modal, then to the manager directly
// — never emailed, never an invite link.
export function generateTempPassword(length = 10): string {
  let password = "";
  for (let i = 0; i < length; i++) {
    password += CHARSET[randomInt(CHARSET.length)];
  }
  return password;
}
