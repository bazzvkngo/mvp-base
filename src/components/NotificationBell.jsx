import React from "react";
import useNotifications from "../hooks/useNotifications";
import NotificationBellView, {
  canViewBusinessNotifications,
} from "./NotificationBellView";

export { canViewBusinessNotifications };

function NotificationBell({ businessId, role }) {
  const canSeeNotifications = canViewBusinessNotifications(role);
  const [open, setOpen] = React.useState(false);
  // businessId vacío si el rol no corresponde: useNotifications nunca
  // llama a subscribeToNotifications en ese caso (mismo patrón que
  // useFinancialMovements/DashboardPage con hasBusinessPermission).
  const notificationsState = useNotifications(canSeeNotifications ? businessId : "");

  if (!canSeeNotifications) return null;

  return (
    <NotificationBellView
      {...notificationsState}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
    />
  );
}

export default NotificationBell;
