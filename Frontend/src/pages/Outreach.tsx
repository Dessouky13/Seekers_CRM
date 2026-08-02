import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SequencesList } from "@/components/modules/outreach/SequencesList";
import { SequenceEditor } from "@/components/modules/outreach/SequenceEditor";
import { EnrollmentsList } from "@/components/modules/outreach/EnrollmentsList";
import { AnalyticsTab } from "@/components/modules/outreach/AnalyticsTab";
import { IngestDocs } from "@/components/modules/outreach/IngestDocs";
import { useCurrentUser } from "@/hooks/useAuth";

export default function Outreach() {
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);
  const currentUser = useCurrentUser();
  const isAdmin = currentUser?.role === "admin";

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Outreach</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated sequences, lead ingestion, and live enrollments.
          </p>
        </div>
      </div>

      {/* Members see only their own leads' enrollments. Sequence authoring,
          company-wide analytics and ingestion setup are admin-only (also
          enforced server-side). */}
      <Tabs defaultValue={isAdmin ? "sequences" : "enrollments"}>
        <TabsList className="mb-4">
          {isAdmin && <TabsTrigger value="sequences">Sequences</TabsTrigger>}
          <TabsTrigger value="enrollments">
            {isAdmin ? "Live Enrollments" : "My Enrollments"}
          </TabsTrigger>
          {isAdmin && <TabsTrigger value="analytics">Analytics</TabsTrigger>}
          {isAdmin && <TabsTrigger value="ingest">Setup & Ingestion</TabsTrigger>}
        </TabsList>

        {isAdmin && (
          <TabsContent value="sequences">
            {selectedSeqId
              ? <SequenceEditor sequenceId={selectedSeqId} onBack={() => setSelectedSeqId(null)} />
              : <SequencesList onOpen={setSelectedSeqId} />}
          </TabsContent>
        )}

        <TabsContent value="enrollments">
          <EnrollmentsList />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="analytics">
            <AnalyticsTab />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="ingest">
            <IngestDocs />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
