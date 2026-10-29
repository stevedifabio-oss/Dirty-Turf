// A source-rendered deleted identity is a state, never a synthetic member ID.
export const DELETED_AUTHOR_PROOF_KEYS = ["kind", "entity", "externalId", "postExternalId", "detailRootId", "avatarId", "role", "ariaLabel", "avatarAlt"];
const id = value => typeof value === "string" && value !== "undefined" && value.length <= 200
  && /^[A-Za-z0-9](?:[A-Za-z0-9._:-]|%[0-9A-Fa-f]{2})*$/.test(value);
export function validDeletedAuthorProof(proof, entity, externalId, postExternalId) {
  return Boolean(proof && typeof proof === "object" && !Array.isArray(proof)
    && Object.keys(proof).length === DELETED_AUTHOR_PROOF_KEYS.length
    && Object.keys(proof).every(key => DELETED_AUTHOR_PROOF_KEYS.includes(key))
    && ["post", "comment"].includes(entity) && id(externalId) && id(postExternalId)
    && proof.kind === "ghl-deleted-user-avatar" && proof.entity === entity
    && proof.externalId === externalId && proof.postExternalId === postExternalId
    && (entity !== "post" || externalId === postExternalId)
    && ["post-view-modal-", "post-view-content-card"].includes(proof.detailRootId)
    && proof.avatarId === "popover-avatar-trigger-undefined" && proof.role === "button"
    && proof.ariaLabel === "View Deleted User's profile" && proof.avatarAlt === "Deleted User");
}
