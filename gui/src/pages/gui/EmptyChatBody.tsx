import { ConversationStarterCards } from "../../components/ConversationStarters";

export interface EmptyChatBodyProps {}

export function EmptyChatBody() {
  return (
    <div className="mx-2 mt-2">
      <ConversationStarterCards />
    </div>
  );
}
