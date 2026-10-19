import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

type Confirmation = {
  title: string;
  description: string;
  actionLabel?: string;
  variant?: 'default' | 'destructive';
};
type Request = Confirmation & {
  routeKey: string;
  resolve: (accepted: boolean) => void;
  trigger: HTMLElement | null;
};

export function useConfirm() {
  const { key: routeKey } = useLocation();
  const activeRoute = useRef<string | null>(null);
  const pending = useRef<Request | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [requestRoute, setRequestRoute] = useState(routeKey);
  if (requestRoute !== routeKey) {
    setRequestRoute(routeKey);
    setRequest(null);
  }

  useLayoutEffect(() => {
    activeRoute.current = routeKey;
    return () => {
      activeRoute.current = null;
      restoreFocus.current = null;
      const current = pending.current;
      pending.current = null;
      current?.resolve(false);
    };
  }, [routeKey]);

  const confirm = useCallback(
    (options: Confirmation): Promise<boolean> => {
      if (activeRoute.current !== routeKey || pending.current) return Promise.resolve(false);
      return new Promise(resolve => {
        const current = {
          ...options,
          routeKey,
          resolve,
          trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        };
        pending.current = current;
        setRequest(current);
      });
    },
    [routeKey],
  );

  const settle = (accepted: boolean) => {
    // Old dialog events must never approve a newer request or a different route.
    if (!request || pending.current !== request) return;
    pending.current = null;
    restoreFocus.current = request.trigger;
    setRequest(null);
    request.resolve(accepted && activeRoute.current === request.routeKey);
  };

  const dialog = (
    <AlertDialog
      open={!!request && request.routeKey === routeKey}
      onOpenChange={open => {
        if (!open) settle(false);
      }}
    >
      {request && request.routeKey === routeKey && (
        <AlertDialogContent
          onCloseAutoFocus={event => {
            event.preventDefault();
            const trigger = restoreFocus.current;
            restoreFocus.current = null;
            if (activeRoute.current !== routeKey || !trigger?.isConnected) return;
            trigger.focus();
            if (document.activeElement === trigger) return;
            const scope =
              trigger.closest<HTMLElement>('form, [data-slot="card"], section, main') ??
              trigger.parentElement;
            const fallback = Array.from(
              scope?.querySelectorAll<HTMLElement>(
                'button, input, select, textarea, a[href], [tabindex]',
              ) ?? [],
            ).find(
              element =>
                element !== trigger &&
                !element.matches(':disabled, [aria-disabled="true"]') &&
                element.tabIndex >= 0 &&
                element.getClientRects().length > 0,
            );
            if (fallback) fallback.focus();
            else if (scope) {
              const tabIndex = scope.getAttribute('tabindex');
              scope.setAttribute('tabindex', '-1');
              scope.focus();
              if (tabIndex === null) scope.removeAttribute('tabindex');
              else scope.setAttribute('tabindex', tabIndex);
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{request.title}</AlertDialogTitle>
            <AlertDialogDescription>{request.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" onClick={() => settle(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant={request.variant ?? 'destructive'}
              onClick={event => {
                event.preventDefault();
                if (event.nativeEvent.isTrusted) settle(true);
              }}
            >
              {request.actionLabel ?? 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );

  return { confirm, dialog };
}
