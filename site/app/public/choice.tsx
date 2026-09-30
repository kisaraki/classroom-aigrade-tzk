"use client";
import { useId, useRef, useState, useEffect } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
export default function Choice({
  label,
  name,
  value,
  defaultValue,
  options,
  onChange,
}: {
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  options: [string, string][];
  onChange?: (value: string) => void;
}) {
  const id = useId(),
    ref = useRef<HTMLButtonElement>(null);
  const [local, setLocal] = useState(defaultValue ?? options[0][0]);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const reset = () => setLocal(defaultValue ?? options[0][0]);
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [defaultValue, options]);
  return (
    <div className="choice-field">
      <label htmlFor={id}>{label}</label>
      <Select
        name={name}
        value={value ?? local}
        onValueChange={(v) => {
          setLocal(v);
          onChange?.(v);
        }}
      >
        <SelectTrigger ref={ref} id={id} className="choice-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="choice-popup">
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
