# Security Specification for Street Safety System Firestore Database

## 1. Data Invariants
1. **User Identity Invariant**: A user document at `/users/{userId}` can only be read or written by the authenticated user whose `request.auth.uid == userId`.
2. **UID Matching Invariant**: In all create/update payloads for `/users/{userId}`, `incoming().uid` must match `request.auth.uid`.
3. **No Privilege Escalation**: Users cannot self-assign admin roles or spoof arbitrary user accounts.
4. **Catch-All Default Deny**: All unspecified paths are denied by default.
5. **Length and Boundary Guards**: Strings are strictly bound by character limits to prevent storage attacks.

## 2. The "Dirty Dozen" Payloads
The following 12 test payloads simulate adversarial attacks and must be rejected:
1. **Unauthenticated Read**: Anonymous user reading `/users/{userId}` -> REJECTED.
2. **Unauthenticated Write**: Anonymous user writing `/users/{userId}` -> REJECTED.
3. **Cross-User Hijack**: User A writing to `/users/userB` -> REJECTED.
4. **UID Spoofing**: User A writing to `/users/userA` with `{ uid: 'userB' }` -> REJECTED.
5. **Missing Required Fields**: User writing `/users/{userId}` without `email` or `displayName` -> REJECTED.
6. **Email Boundary Attack**: User writing email with length > 254 chars -> REJECTED.
7. **DisplayName Boundary Attack**: User writing displayName with length > 100 chars -> REJECTED.
8. **Invalid Path Variable**: Document ID with invalid characters (e.g., path traversal or non-alphanumeric) -> REJECTED.
9. **Shadow Fields Attack**: User writing unexpected keys not defined in schema -> REJECTED.
10. **Type Poisoning Attack**: User passing boolean or number for `displayName` -> REJECTED.
11. **Test Document Mutation by Unauthorized User**: Non-whitelisted write to `/test/{testId}` -> REJECTED.
12. **Catch-All Probe**: Any read/write to `/system/config` or `/admin_secrets` -> REJECTED.

## 3. Test Runner Specification
The rules must be verified with `@firebase/rules-unit-testing` or ESLint rules plugin to verify that all unauthorized mutations and reads fail with `PERMISSION_DENIED`.
