import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import type { WebUiAccessInfo } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { usePlatform } from "@/hooks/usePlatform.js";

/**
 * The phone pairing panel: it shows the address the server listens on and a
 * QR code for it. The server answers whether it left the machine at all, so
 * the panel either hands out a working code or says what to run instead of
 * showing a code that cannot be scanned.
 */
export function MobileRemoteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  const [info, setInfo] = useState<WebUiAccessInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setInfo(null);
    setFailed(false);
    setQrDataUrl(null);
    void platform
      .getWebUiAccessInfo?.()
      .then((access) => {
        if (cancelled) return;
        if (!access) {
          setFailed(true);
          return;
        }
        setInfo(access);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, platform]);

  const lanUrl = info?.lanEnabled ? info.urls[1] : undefined;

  useEffect(() => {
    if (!lanUrl) {
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(lanUrl, {
      margin: 1,
      width: 240,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lanUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-4">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "mobileRemote.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "mobileRemote.description" })}
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "mobileRemote.unavailable" })}
          </p>
        ) : !info ? (
          <p className="flex items-center gap-2 text-ui-base text-foreground-subtle">
            <LoaderIcon className="size-4 animate-spin" />
            {intl.formatMessage({ id: "mobileRemote.loading" })}
          </p>
        ) : lanUrl ? (
          <div className="flex flex-col items-center gap-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={intl.formatMessage({ id: "mobileRemote.qrAlt" })}
                className="size-56 rounded-md bg-white p-2"
              />
            ) : null}
            <code className="w-full break-all rounded-md bg-surface px-3 py-2 text-center font-mono text-ui-sm text-foreground">
              {lanUrl}
            </code>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-ui-base text-foreground">
              {intl.formatMessage({ id: "mobileRemote.loopbackTitle" })}
            </p>
            <p className="text-ui-base text-foreground-subtle">
              {intl.formatMessage({ id: "mobileRemote.loopbackHint" })}
            </p>
            <code className="w-full break-all rounded-md bg-surface px-3 py-2 font-mono text-ui-sm text-foreground">
              tnt webui --host 0.0.0.0
            </code>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => onOpenChange(false)}
          >
            {intl.formatMessage({ id: "common.close" })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
