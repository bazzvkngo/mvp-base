import { buildValuationForItem } from "../domain/pricing";
import { subscribeToInventory } from "./inventoryService";
import { subscribeToReferences } from "./referenceService";

function groupReferencesByItem(references) {
  return references.reduce((groups, reference) => {
    if ((reference.estado || "activa") !== "activa") return groups;
    const itemId = reference.itemId || "";
    if (!itemId) return groups;

    if (!groups[itemId]) {
      groups[itemId] = [];
    }
    groups[itemId].push(reference);
    return groups;
  }, {});
}

export function buildValuations(inventoryItems, references) {
  const activeInventory = Array.isArray(inventoryItems)
    ? inventoryItems.filter((item) => (item.estado || "activo") === "activo")
    : [];
  const referencesByItem = groupReferencesByItem(Array.isArray(references) ? references : []);

  return activeInventory.map((item) =>
    buildValuationForItem(item, referencesByItem[item.id] || [])
  );
}

export function subscribeToValuations(uid, onValuations, onError) {
  let inventoryItems = [];
  let references = [];
  let inventoryLoaded = false;
  let referencesLoaded = false;

  const emitIfReady = () => {
    if (!inventoryLoaded || !referencesLoaded) return;
    onValuations(buildValuations(inventoryItems, references));
  };

  const unsubscribeInventory = subscribeToInventory(
    uid,
    (items) => {
      inventoryItems = items;
      inventoryLoaded = true;
      emitIfReady();
    },
    onError
  );

  const unsubscribeReferences = subscribeToReferences(
    uid,
    (items) => {
      references = items;
      referencesLoaded = true;
      emitIfReady();
    },
    onError
  );

  return () => {
    unsubscribeInventory();
    unsubscribeReferences();
  };
}
