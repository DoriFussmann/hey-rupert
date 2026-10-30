import { redirect } from "next/navigation";

// The brief now lives on the client page, as the first Setup step.
export default function FramingRoomPage({ params }: { params: { id: string } }) {
  redirect(`/admin/clients/${params.id}#setup-brief`);
}
