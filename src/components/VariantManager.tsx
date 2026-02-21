import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Tag } from "lucide-react";

export interface VariantValue {
  value: string;
  price_source?: number | null;
  stock?: number | null;
  source_id?: string;
}

export interface VariantGroup {
  name: string;
  values: VariantValue[];
}

interface VariantManagerProps {
  variants: VariantGroup[];
  onChange: (variants: VariantGroup[]) => void;
  readOnly?: boolean;
}

export function VariantManager({ variants, onChange, readOnly }: VariantManagerProps) {
  const [newGroupName, setNewGroupName] = useState("");

  function addGroup() {
    if (!newGroupName.trim()) return;
    onChange([...variants, { name: newGroupName.trim(), values: [{ value: "" }] }]);
    setNewGroupName("");
  }

  function removeGroup(idx: number) {
    onChange(variants.filter((_, i) => i !== idx));
  }

  function addValue(groupIdx: number) {
    const updated = [...variants];
    updated[groupIdx] = {
      ...updated[groupIdx],
      values: [...updated[groupIdx].values, { value: "" }],
    };
    onChange(updated);
  }

  function removeValue(groupIdx: number, valueIdx: number) {
    const updated = [...variants];
    updated[groupIdx] = {
      ...updated[groupIdx],
      values: updated[groupIdx].values.filter((_, i) => i !== valueIdx),
    };
    if (updated[groupIdx].values.length === 0) {
      onChange(updated.filter((_, i) => i !== groupIdx));
    } else {
      onChange(updated);
    }
  }

  function updateValue(groupIdx: number, valueIdx: number, field: keyof VariantValue, val: any) {
    const updated = [...variants];
    updated[groupIdx] = {
      ...updated[groupIdx],
      values: updated[groupIdx].values.map((v, i) =>
        i === valueIdx ? { ...v, [field]: val } : v
      ),
    };
    onChange(updated);
  }

  if (readOnly && variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Keine Varianten vorhanden.</p>
    );
  }

  return (
    <div className="space-y-4">
      {variants.map((group, gi) => (
        <div key={gi} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">{group.name}</span>
              <span className="text-xs text-muted-foreground">({group.values.length} Werte)</span>
            </div>
            {!readOnly && (
              <Button variant="ghost" size="sm" onClick={() => removeGroup(gi)} className="text-destructive hover:text-destructive">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {group.values.map((val, vi) => (
              <div key={vi} className="flex items-center gap-2">
                <Input
                  value={val.value}
                  onChange={(e) => updateValue(gi, vi, "value", e.target.value)}
                  placeholder="z.B. Rot, XL, 500ml"
                  className="flex-1 rounded-xl text-sm"
                  readOnly={readOnly}
                />
                <Input
                  type="number"
                  value={val.price_source ?? ""}
                  onChange={(e) => updateValue(gi, vi, "price_source", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Preis €"
                  className="w-24 rounded-xl text-sm font-mono"
                  readOnly={readOnly}
                />
                <Input
                  type="number"
                  value={val.stock ?? ""}
                  onChange={(e) => updateValue(gi, vi, "stock", e.target.value ? Number(e.target.value) : null)}
                  placeholder="Bestand"
                  className="w-20 rounded-xl text-sm font-mono"
                  readOnly={readOnly}
                />
                {!readOnly && (
                  <Button variant="ghost" size="sm" onClick={() => removeValue(gi, vi)} className="text-muted-foreground hover:text-destructive px-2">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => addValue(gi)} className="rounded-xl text-xs">
              <Plus className="w-3 h-3" /> Wert hinzufügen
            </Button>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex items-center gap-2">
          <Input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="Neue Variante (z.B. Farbe, Größe)"
            className="flex-1 rounded-xl text-sm"
            onKeyDown={(e) => e.key === "Enter" && addGroup()}
          />
          <Button variant="outline" size="sm" onClick={addGroup} disabled={!newGroupName.trim()} className="rounded-xl">
            <Plus className="w-3.5 h-3.5" /> Variante
          </Button>
        </div>
      )}
    </div>
  );
}
