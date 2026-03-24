import { Dispatch, SetStateAction } from 'react';

interface DarkSelectProps {
  value: string;
  onChange: Dispatch<SetStateAction<string>> | ((value: string) => void);
  options: { value: string; label: string }[];
  compact?: boolean;
  className?: string;
}

export default function DarkSelect(props: DarkSelectProps): JSX.Element;
