const text = (value) => String(value || "").trim();

const documentNode = (type, id, number, currentType, placeholder = "") => ({
  type,
  id: text(id),
  number: text(number) || placeholder,
  current: type === currentType,
  placeholder: !text(id),
});

export function buildSupplyTrace({currentType, order = null, purchase = null, receptions = []} = {}) {
  const orderNode = order || (purchase?.ordenCompraId ? {
    id: purchase.ordenCompraId,
    numero: purchase.ordenCompraNumero,
  } : null);
  const relatedReceptions = Array.isArray(receptions) ? [...receptions] : [];
  if (
    purchase?.recepcionId &&
    !relatedReceptions.some((reception) =>
      text(reception?.id || reception?.recepcionId) === text(purchase.recepcionId)
    )
  ) {
    relatedReceptions.push({
      id: purchase.recepcionId,
      numero: purchase.recepcionNumero,
      compraId: purchase.id || purchase.compraId,
      compraNumero: purchase.numero,
    });
  }

  const purchaseDocument = (reception = null) => {
    const receptionId = text(reception?.id || reception?.recepcionId);
    const linkedPurchase = purchase?.recepcionId &&
      text(purchase.recepcionId) === receptionId
      ? purchase
      : null;
    const id = linkedPurchase?.id || linkedPurchase?.compraId || reception?.compraId;
    if (!text(id)) return null;
    return documentNode(
      "purchase",
      id,
      linkedPurchase?.numero || reception?.compraNumero,
      currentType,
      "Compra"
    );
  };

  if (!orderNode) {
    if (relatedReceptions.length) {
      const rows = relatedReceptions.map((reception) => [
        documentNode("reception", reception.id || reception.recepcionId, reception.numero, currentType, "Recepción"),
        purchaseDocument(reception),
      ].filter(Boolean));
      if (purchase && !purchase.recepcionId) {
        rows.push([documentNode("purchase", purchase.id || purchase.compraId, purchase.numero, currentType, "Compra directa")]);
      }
      return rows;
    }
    return purchase
      ? [[documentNode("purchase", purchase.id || purchase.compraId, purchase.numero, currentType, "Compra directa")]]
      : [];
  }

  if (!relatedReceptions.length) {
    const row = [documentNode(
      "order",
      orderNode.id || orderNode.ordenCompraId,
      orderNode.numero,
      currentType,
      "Orden de compra"
    )];
    if (purchase) {
      row.push(documentNode("purchase", purchase.id || purchase.compraId, purchase.numero, currentType, "Compra"));
    } else {
      row.push(documentNode("reception", "", "", currentType, "Recepción pendiente"));
    }
    return [row];
  }

  const rows = relatedReceptions.map((reception) => {
    const row = [
      documentNode("order", orderNode.id || orderNode.ordenCompraId, orderNode.numero, currentType, "Orden de compra"),
      documentNode("reception", reception.id || reception.recepcionId, reception.numero, currentType, "Recepción"),
    ];
    const linkedPurchase = purchaseDocument(reception);
    if (linkedPurchase) row.push(linkedPurchase);
    return row;
  });
  if (purchase && !purchase.recepcionId) {
    rows.push([
      documentNode("order", orderNode.id || orderNode.ordenCompraId, orderNode.numero, currentType, "Orden de compra"),
      documentNode("purchase", purchase.id || purchase.compraId, purchase.numero, currentType, "Compra"),
    ]);
  }
  return rows;
}

export function getSupplyDocumentRoute(node = {}) {
  if (!node.id || node.placeholder) return "";
  return ({
    order: `/ordenes-compra/${node.id}`,
    reception: `/recepciones/${node.id}`,
    purchase: `/compras/${node.id}`,
  })[node.type] || "";
}

export function getSupplyDocumentLabel(type) {
  return ({order: "Orden de compra", reception: "Recepción", purchase: "Compra"})[type] || "Documento";
}
