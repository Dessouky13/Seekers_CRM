import { useState, useRef } from "react";
import { Upload, FileText, Search, Trash2, Loader2, CheckCircle, XCircle, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, API_BASE } from "@/lib/api";
import { getStoredToken } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { ApiApiKbDocument } from "@/lib/types";

interface RagResult {
  answer: string;
  sources: { document_id: string; document_title: string; chunk_content: string; similarity_score: number }[];
}

const statusIcon = {
  processing: <Loader2 className="h-3 w-3 animate-spin text-warning" />,
  ready:      <CheckCircle className="h-3 w-3 text-success" />,
  error:      <XCircle className="h-3 w-3 text-destructive" />,
};

const statusBadge = {
  processing: "bg-warning/15 text-warning",
  ready:      "bg-success/15 text-success",
  error:      "bg-destructive/15 text-destructive",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function Knowledge() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [query, setQuery]           = useState("");
  const [result, setResult]         = useState<RagResult | null>(null);
  const [querying, setQuerying]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data: documents = [], isLoading } = useQuery<ApiKbDocument[]>({
    queryKey: ["kb-documents"],
    queryFn:  () => apiFetch("/knowledge/documents"),
    refetchInterval: (query) => {
      const docs = query.state.data as ApiKbDocument[] | undefined;
      return docs?.some((d) => d.status === "processing") ? 5000 : false;
    },
  });

  const deleteDoc = useMutation({
    mutationFn: (id: string) => apiFetch(`/knowledge/documents/${id}`, { method: "DELETE" }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["kb-documents"] }); toast.success("Document deleted"); },
    onError:    (err) => toast.error(err.message),
  });

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Select a file");

    const formData = new FormData();
    formData.append("file", file);
    const title = fd.get("title") as string;
    if (title) formData.append("title", title);

    try {
      const token = getStoredToken();
      const res = await fetch(`${API_BASE}/knowledge/documents`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      setUploadOpen(false);
      qc.invalidateQueries({ queryKey: ["kb-documents"] });
      toast.success("Document uploaded — embedding in progress");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleQuery = async () => {
    if (!query.trim()) return;
    setQuerying(true);
    setResult(null);
    try {
      const data = await apiFetch<RagResult>("/knowledge/query", {
        method: "POST",
        body: JSON.stringify({ query: query.trim() }),
      });
      setResult(data);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Upload documents and query the Agency Brain.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setUploadOpen(true)}>
          <Upload className="h-3.5 w-3.5" /> Upload Document
        </Button>
      </div>

      {/* RAG Query */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Agency Brain</h2>
        </div>
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleQuery()}
            placeholder="Ask a question about your documents…"
            className="flex-1"
          />
          <Button onClick={handleQuery} disabled={querying || !query.trim()} className="gap-1.5 shrink-0">
            {querying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            Ask
          </Button>
        </div>
        {result && (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted/40 p-4 text-sm text-foreground whitespace-pre-wrap">{result.answer}</div>
            {result.sources.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Sources</p>
                <div className="space-y-1.5">
                  {result.sources.map((s, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                      <span><span className="font-medium text-foreground">{s.document_title}</span> — {s.chunk_content.slice(0, 120)}…</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Document list */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Documents ({documents.length})</h2>
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
        ) : documents.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-12 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No documents yet. Upload a PDF or text file above.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Title", "Type", "Size", "Status", "Uploaded", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-medium flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {doc.title}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground uppercase text-xs">{doc.fileType ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{doc.fileSize ? formatBytes(doc.fileSize) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full", statusBadge[doc.status])}>
                        {statusIcon[doc.status]}
                        {doc.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{doc.createdAt.slice(0, 10)}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => deleteDoc.mutate(doc.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Document</DialogTitle></DialogHeader>
          <form onSubmit={handleUpload} className="space-y-4">
            <div><Label>Title (optional)</Label><Input name="title" className="mt-1" placeholder="Leave blank to use filename" /></div>
            <div>
              <Label>File</Label>
              <input ref={fileRef} type="file" accept=".pdf,.txt,.md" required className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer" />
              <p className="text-xs text-muted-foreground mt-1">Supported: PDF, TXT, Markdown (max 50 MB)</p>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
              <Button type="submit" className="gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
