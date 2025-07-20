import { useDispatch } from "react-redux";
import AddDocsDialog from "../../../components/dialogs/AddDocsDialog";
import { Card, Divider } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import { setDialogMessage, setShowDialog } from "../../../redux/slices/uiSlice";
import { ConfigHeader } from "../components/ConfigHeader";
import DocsIndexingStatuses from "./docs/DocsSection";

export function DocsSection() {
  const dispatch = useDispatch();
  const { t } = useI18n();

  function handleAddDocs() {
    dispatch(setShowDialog(true));
    dispatch(setDialogMessage(<AddDocsDialog />));
  }

  return (
    <div>
      <ConfigHeader
        title={t("help.documentation")}
        onAddClick={handleAddDocs}
        addButtonTooltip={t("docs.add")}
        variant="sm"
      />

      <Card>
        <div className="py-2">
          <DocsIndexingStatuses />
        </div>
      </Card>
    </div>
  );
}
