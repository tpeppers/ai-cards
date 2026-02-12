import React, { useState } from 'react';
import { STRATEGY_REGISTRY } from '../strategies/index.ts';

interface StrategyConfigModalProps {
  tableStrategy: string | null;
  playerOverrides: (string | null)[];
  onApply: (tableStrategy: string | null, overrides: (string | null)[]) => void;
  onCancel: () => void;
}

const PLAYER_LABELS = ['You (South)', 'East', 'North', 'West'];

const bidWhistStrategies = STRATEGY_REGISTRY.filter(s => s.game === 'bidwhist');

function strategyNameFromText(text: string | null): string {
  if (text === null) return 'Default AI';
  return STRATEGY_REGISTRY.find(s => s.text === text)?.name || 'Custom';
}

const StrategyConfigModal: React.FC<StrategyConfigModalProps> = ({
  tableStrategy,
  playerOverrides,
  onApply,
  onCancel,
}) => {
  const [localTable, setLocalTable] = useState<string | null>(tableStrategy);
  const [localOverrides, setLocalOverrides] = useState<(string | null)[]>([...playerOverrides]);

  const setOverride = (index: number, value: string | null) => {
    setLocalOverrides(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Dropdown for table strategy: Default AI + all bidwhist strategies
  // Dropdown for per-player: "Use table strategy" (null) + "Default AI" ("") + all bidwhist strategies
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-lg shadow-xl p-5 w-80 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">Strategy Configuration</h2>

        {/* Table strategy */}
        <div className="mb-4">
          <label className="block text-sm font-semibold text-gray-700 mb-1">Table Strategy</label>
          <select
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            value={localTable === null ? '__default__' : localTable}
            onChange={(e) => setLocalTable(e.target.value === '__default__' ? null : e.target.value)}
          >
            <option value="__default__">Default AI</option>
            {bidWhistStrategies.map(s => (
              <option key={s.name} value={s.text}>{s.name}</option>
            ))}
          </select>
        </div>

        <hr className="my-3 border-gray-200" />

        {/* Per-player overrides */}
        <div className="text-sm font-semibold text-gray-700 mb-2">Per-Player Overrides</div>
        {PLAYER_LABELS.map((label, i) => (
          <div key={i} className="mb-3">
            <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
            <select
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
              value={
                localOverrides[i] === null
                  ? '__table__'
                  : localOverrides[i] === ''
                    ? '__default__'
                    : localOverrides[i]!
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === '__table__') setOverride(i, null);
                else if (val === '__default__') setOverride(i, '');
                else setOverride(i, val);
              }}
            >
              <option value="__table__">
                Use table strategy ({strategyNameFromText(localTable)})
              </option>
              <option value="__default__">Default AI</option>
              {bidWhistStrategies.map(s => (
                <option key={s.name} value={s.text}>{s.name}</option>
              ))}
            </select>
          </div>
        ))}

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="px-4 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-100"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
            onClick={() => onApply(localTable, localOverrides)}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default StrategyConfigModal;
