import React, { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import {
  User,
  DisciplinaryWriteUp,
  WriteUpCategory,
  WriteUpSeverity
} from '../types';
import {
  FileWarning,
  X,
  CheckCircle2,
  AlertTriangle,
  PenTool,
  Eraser,
  Printer,
  Clock,
  ShieldAlert,
  Sparkles,
  UserCheck
} from 'lucide-react';

interface DigitalWriteUpModalProps {
  targetUser: User;
  currentManager: User;
  existingWriteUp?: DisciplinaryWriteUp | null;
  initialCategory?: WriteUpCategory;
  initialShiftTitle?: string;
  initialDescription?: string;
  onClose: () => void;
  onSaveWriteUp: (updatedUser: User, savedWriteUp: DisciplinaryWriteUp) => Promise<void>;
}

const CATEGORY_TEMPLATES: Record<
  WriteUpCategory,
  { defaultSeverity: WriteUpSeverity; description: string; correctivePlan: string }
> = {
  'No-Call No-Show': {
    defaultSeverity: 'Final Written Warning (Strike 2)',
    description:
      'Team member failed to report for their scheduled [SHIFT] and did not notify management prior to or within 30 minutes of the scheduled shift start time.',
    correctivePlan:
      'Team member must adhere to all scheduled shifts and communicate any absence or emergency to management at least 2 hours prior to shift start. Any further No-Call No-Show infraction may result in immediate termination.'
  },
  'Failure to Communicate': {
    defaultSeverity: 'Written Warning (Strike 1)',
    description:
      'Team member was more than 5 minutes late for their scheduled [SHIFT] and failed to respond to the automated 5-minute tardy check-in message within 30 minutes of shift start.',
    correctivePlan:
      'When running late or experiencing an unexpected delay, the team member must immediately reply to the automated tardy DM prompt or contact a manager directly before or within 5 minutes of shift start.'
  },
  'Excessive Tardiness': {
    defaultSeverity: 'Written Warning (Strike 1)',
    description:
      'Team member has accumulated repeated late clock-ins within a rolling 30-day window, impacting shift handoffs and departmental production.',
    correctivePlan:
      'Team member must arrive and clock in on the Master iPad at or before the scheduled [SHIFT] start time. Continued tardiness will escalate to Final Written Warning or Termination Review.'
  },
  'Poor Employee Conduct / Insubordination': {
    defaultSeverity: 'Written Warning (Strike 1)',
    description:
      'Team member demonstrated unprofessional workplace conduct, refusal to follow reasonable manager instructions, or behavior inconsistent with team standards.',
    correctivePlan:
      'Team member must maintain professional, respectful communication with management and coworkers at all times and follow assigned operational directives.'
  },
  'SOP / Quality Violation': {
    defaultSeverity: 'Verbal Warning',
    description:
      'Team member did not follow established Standard Operating Procedures (SOPs) or quality verification checkpoints for their assigned department task.',
    correctivePlan:
      'Team member must review and strictly follow departmental SOPs, complete required quality checks, and upload verification photos when prompted.'
  },
  'Missed Hourly Check-Ins': {
    defaultSeverity: 'Verbal Warning',
    description:
      'Team member repeatedly failed to complete required hourly mobile check-ins while clocked in on shift, resulting in unverified idle time.',
    correctivePlan:
      'Team member must respond promptly to hourly mobile check-in notifications and log accurate departmental progress throughout their shift.'
  }
};

const ALL_CATEGORIES: WriteUpCategory[] = [
  'No-Call No-Show',
  'Failure to Communicate',
  'Excessive Tardiness',
  'Poor Employee Conduct / Insubordination',
  'SOP / Quality Violation',
  'Missed Hourly Check-Ins'
];

const ALL_SEVERITIES: WriteUpSeverity[] = [
  'Verbal Warning',
  'Written Warning (Strike 1)',
  'Final Written Warning (Strike 2)',
  'Suspension / Termination Review (Strike 3)'
];

export const DigitalWriteUpModal: React.FC<DigitalWriteUpModalProps> = ({
  targetUser,
  currentManager,
  existingWriteUp,
  initialCategory = 'Failure to Communicate',
  initialShiftTitle = '',
  initialDescription,
  onClose,
  onSaveWriteUp
}) => {
  const todayStr = new Date().toLocaleDateString('en-CA');

  const [category, setCategory] = useState<WriteUpCategory>(
    existingWriteUp?.category || initialCategory
  );
  const [severity, setSeverity] = useState<WriteUpSeverity>(
    existingWriteUp?.severity || CATEGORY_TEMPLATES[initialCategory].defaultSeverity
  );
  const [incidentDate, setIncidentDate] = useState<string>(
    existingWriteUp?.incidentDate || todayStr
  );
  const [shiftTitle, setShiftTitle] = useState<string>(
    existingWriteUp?.shiftTitle || initialShiftTitle
  );
  const [description, setDescription] = useState<string>(
    existingWriteUp?.description ||
      initialDescription ||
      CATEGORY_TEMPLATES[initialCategory].description
  );
  const [correctiveActionPlan, setCorrectiveActionPlan] = useState<string>(
    existingWriteUp?.correctiveActionPlan ||
      CATEGORY_TEMPLATES[initialCategory].correctivePlan
  );
  const [employeeComments, setEmployeeComments] = useState<string>(
    existingWriteUp?.employeeComments || ''
  );
  const [refusedToSign, setRefusedToSign] = useState<boolean>(
    existingWriteUp?.refusedToSign || false
  );
  const [witnessManagerName, setWitnessManagerName] = useState<string>(
    existingWriteUp?.witnessManagerName || ''
  );
  const [isSaving, setIsSaving] = useState(false);

  const empSigRef = useRef<SignatureCanvas>(null);
  const mgrSigRef = useRef<SignatureCanvas>(null);

  const isReadOnlySigned =
    existingWriteUp?.status === 'Acknowledged' ||
    existingWriteUp?.status === 'Refused to Sign';

  const handleCategoryChange = (newCat: WriteUpCategory) => {
    setCategory(newCat);
    if (!existingWriteUp) {
      const tpl = CATEGORY_TEMPLATES[newCat];
      setSeverity(tpl.defaultSeverity);
      setDescription(tpl.description);
      setCorrectiveActionPlan(tpl.correctivePlan);
    }
  };

  const applyTemplateText = () => {
    const tpl = CATEGORY_TEMPLATES[category];
    setDescription(tpl.description);
    setCorrectiveActionPlan(tpl.correctivePlan);
  };

  const getStrikeFromSeverity = (sev: WriteUpSeverity, currentStrike?: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 => {
    const base = currentStrike || 0;
    if (sev === 'Written Warning (Strike 1)') return Math.max(base, 1) as 0 | 1 | 2 | 3;
    if (sev === 'Final Written Warning (Strike 2)') return Math.max(base, 2) as 0 | 1 | 2 | 3;
    if (sev === 'Suspension / Termination Review (Strike 3)') return 3;
    return base;
  };

  const handleSaveDraftPending = async () => {
    if (!description.trim()) {
      alert('Please provide an infraction description.');
      return;
    }
    setIsSaving(true);
    try {
      const writeUp: DisciplinaryWriteUp = {
        id: existingWriteUp?.id || `wu-${Date.now()}`,
        userId: targetUser.id,
        userName: targetUser.name,
        date: existingWriteUp?.date || todayStr,
        createdAt: existingWriteUp?.createdAt || Date.now(),
        issuedByManagerId: existingWriteUp?.issuedByManagerId || currentManager.id,
        issuedByManagerName: existingWriteUp?.issuedByManagerName || currentManager.name,
        category,
        severity,
        incidentDate,
        shiftTitle: shiftTitle.trim() || undefined,
        description: description.trim(),
        correctiveActionPlan: correctiveActionPlan.trim(),
        employeeComments: employeeComments.trim() || undefined,
        status: 'Pending Signature',
        autoGenerated: existingWriteUp?.autoGenerated || false
      };

      const existingList = targetUser.disciplinaryWriteUps || [];
      const updatedList = existingWriteUp
        ? existingList.map(w => (w.id === writeUp.id ? writeUp : w))
        : [writeUp, ...existingList];

      const updatedUser: User = {
        ...targetUser,
        disciplinaryWriteUps: updatedList
      };

      await onSaveWriteUp(updatedUser, writeUp);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalizeAndSign = async () => {
    if (!description.trim()) {
      alert('Please provide an infraction description.');
      return;
    }

    const mgrEmpty =
      !existingWriteUp?.managerSignatureDataUrl &&
      (!mgrSigRef.current || (mgrSigRef.current as any).isEmpty());
    if (mgrEmpty) {
      alert('Manager signature is required on the Master iPad to finalize this write-up.');
      return;
    }

    const empEmpty =
      !existingWriteUp?.employeeSignatureDataUrl &&
      (!empSigRef.current || (empSigRef.current as any).isEmpty());
    if (!refusedToSign && empEmpty) {
      alert(
        'Please have the team member sign on the Master iPad, or check "Employee Refused to Sign" if they decline.'
      );
      return;
    }

    setIsSaving(true);
    try {
      const mgrSigDataUrl =
        existingWriteUp?.managerSignatureDataUrl ||
        (mgrSigRef.current as any).getTrimmedCanvas().toDataURL('image/png');

      const empSigDataUrl = refusedToSign
        ? undefined
        : existingWriteUp?.employeeSignatureDataUrl ||
          (empSigRef.current as any).getTrimmedCanvas().toDataURL('image/png');

      const now = Date.now();
      const finalStatus: DisciplinaryWriteUp['status'] = refusedToSign
        ? 'Refused to Sign'
        : 'Acknowledged';

      const writeUp: DisciplinaryWriteUp = {
        id: existingWriteUp?.id || `wu-${now}`,
        userId: targetUser.id,
        userName: targetUser.name,
        date: existingWriteUp?.date || todayStr,
        createdAt: existingWriteUp?.createdAt || now,
        issuedByManagerId: currentManager.id,
        issuedByManagerName: currentManager.name,
        category,
        severity,
        incidentDate,
        shiftTitle: shiftTitle.trim() || undefined,
        description: description.trim(),
        correctiveActionPlan: correctiveActionPlan.trim(),
        employeeComments: employeeComments.trim() || undefined,
        employeeSignatureDataUrl: empSigDataUrl,
        employeeSignedAt: empSigDataUrl ? now : undefined,
        refusedToSign,
        witnessManagerName: refusedToSign ? witnessManagerName.trim() || undefined : undefined,
        managerSignatureDataUrl: mgrSigDataUrl,
        managerSignedAt: now,
        status: finalStatus,
        autoGenerated: existingWriteUp?.autoGenerated || false
      };

      const existingList = targetUser.disciplinaryWriteUps || [];
      const updatedList = existingWriteUp
        ? existingList.map(w => (w.id === writeUp.id ? writeUp : w))
        : [writeUp, ...existingList];

      const newStrikeLevel = getStrikeFromSeverity(severity, targetUser.strikeLevel);

      // Also append a summary entry to counselingNotes for continuity
      const counselingEntry = {
        date: todayStr,
        managerName: currentManager.name,
        notes: `[OFFICIAL WRITE-UP: ${category} — ${severity}] ${description.trim()} (${finalStatus})`
      };

      const updatedUser: User = {
        ...targetUser,
        strikeLevel: newStrikeLevel,
        disciplinaryWriteUps: updatedList,
        counselingNotes: [counselingEntry, ...(targetUser.counselingNotes || [])]
      };

      await onSaveWriteUp(updatedUser, writeUp);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-[80] p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-950 via-red-900 to-slate-900 text-white px-6 py-5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-400/30 flex items-center justify-center">
              <FileWarning className="w-6 h-6 text-red-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight">
                  Master iPad Digital Disciplinary Write-Up
                </h2>
                {existingWriteUp?.autoGenerated && (
                  <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-200 border border-amber-400/30 rounded-full">
                    Auto-Generated
                  </span>
                )}
              </div>
              <p className="text-xs text-red-200/80 font-medium">
                Employee: <span className="font-bold text-white">{targetUser.name}</span> • Issued By:{' '}
                <span className="font-bold text-white">{currentManager.name}</span> • Manager-Only Record
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Print Write-Up"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Status Banner if existing */}
          {existingWriteUp && (
            <div
              className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                existingWriteUp.status === 'Acknowledged'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : existingWriteUp.status === 'Refused to Sign'
                  ? 'bg-red-50 border-red-200 text-red-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {existingWriteUp.status === 'Acknowledged' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-black uppercase tracking-wider">
                    Status: {existingWriteUp.status}
                  </div>
                  <div className="text-xs opacity-80">
                    Created {new Date(existingWriteUp.createdAt).toLocaleString()}
                    {existingWriteUp.employeeSignedAt
                      ? ` • Signed ${new Date(existingWriteUp.employeeSignedAt).toLocaleString()}`
                      : ''}
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white/80 border border-black/5">
                Current Profile Strike: {targetUser.strikeLevel || 0}/3
              </span>
            </div>
          )}

          {/* Category & Severity Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Infraction Category
              </label>
              <select
                disabled={isReadOnlySigned}
                value={category}
                onChange={e => handleCategoryChange(e.target.value as WriteUpCategory)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 font-bold text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {ALL_CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Disciplinary Severity / Strike Level
              </label>
              <select
                disabled={isReadOnlySigned}
                value={severity}
                onChange={e => setSeverity(e.target.value as WriteUpSeverity)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 font-bold text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {ALL_SEVERITIES.map(sev => (
                  <option key={sev} value={sev}>
                    {sev}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Incident Date & Shift Title */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Incident Date
              </label>
              <input
                type="date"
                disabled={isReadOnlySigned}
                value={incidentDate}
                onChange={e => setIncidentDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 font-semibold text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
                Associated [SHIFT] or Context (Optional)
              </label>
              <input
                type="text"
                disabled={isReadOnlySigned}
                value={shiftTitle}
                onChange={e => setShiftTitle(e.target.value)}
                placeholder="e.g. [SHIFT] Morning Production (9:00 AM)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 bg-slate-50 font-semibold text-sm text-slate-900"
              />
            </div>
          </div>

          {/* Description of Infraction */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500">
                Factual Description of Infraction
              </label>
              {!isReadOnlySigned && (
                <button
                  type="button"
                  onClick={applyTemplateText}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                >
                  <Sparkles className="w-3 h-3" /> Reset to Standard Template
                </button>
              )}
            </div>
            <textarea
              rows={3}
              disabled={isReadOnlySigned}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full p-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Describe the specific attendance, communication, or conduct violation..."
            />
          </div>

          {/* Corrective Action Plan */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Required Corrective Action & Expectations
            </label>
            <textarea
              rows={3}
              disabled={isReadOnlySigned}
              value={correctiveActionPlan}
              onChange={e => setCorrectiveActionPlan(e.target.value)}
              className="w-full p-3.5 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Outline the exact expectations moving forward..."
            />
          </div>

          {/* Employee Statement / Comments */}
          <div>
            <label className="block text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1.5">
              Team Member Comments / Statement (Optional)
            </label>
            <textarea
              rows={2}
              disabled={isReadOnlySigned}
              value={employeeComments}
              onChange={e => setEmployeeComments(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Optional statement from the team member during the Master iPad coaching session..."
            />
          </div>

          {/* Master iPad Signature Section */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PenTool className="w-4 h-4 text-red-600" />
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Master iPad Touchscreen Signatures
                </h3>
              </div>

              {!isReadOnlySigned && (
                <label className="flex items-center gap-2 text-xs font-bold text-red-700 bg-red-50 px-3 py-1.5 rounded-xl border border-red-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refusedToSign}
                    onChange={e => setRefusedToSign(e.target.checked)}
                    className="rounded border-red-300 text-red-600 focus:ring-red-500"
                  />
                  Employee Refused to Sign on Master iPad
                </label>
              )}
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              By signing below, the team member acknowledges receipt of this disciplinary write-up and confirms that it was discussed with management. Signing does not necessarily indicate agreement with all statements above, but verifies the coaching conversation took place.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Employee Signature Pad */}
              <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">
                    Team Member Signature ({targetUser.name})
                  </span>
                  {!isReadOnlySigned && !refusedToSign && (
                    <button
                      type="button"
                      onClick={() => empSigRef.current?.clear()}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 flex items-center gap-1"
                    >
                      <Eraser className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                {refusedToSign ? (
                  <div className="h-32 rounded-lg bg-red-50/70 border border-dashed border-red-300 flex flex-col items-center justify-center p-3 text-center">
                    <ShieldAlert className="w-6 h-6 text-red-600 mb-1" />
                    <span className="text-xs font-black text-red-800 uppercase">
                      Employee Refused to Sign
                    </span>
                    <input
                      type="text"
                      disabled={isReadOnlySigned}
                      value={witnessManagerName}
                      onChange={e => setWitnessManagerName(e.target.value)}
                      placeholder="Witness Name (Optional)"
                      className="mt-2 w-full max-w-[220px] px-2.5 py-1 text-xs rounded-lg border border-red-200 bg-white text-slate-800 text-center"
                    />
                  </div>
                ) : existingWriteUp?.employeeSignatureDataUrl ? (
                  <div className="h-32 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center p-2">
                    <img
                      src={existingWriteUp.employeeSignatureDataUrl}
                      alt="Employee Signature"
                      className="max-h-28 object-contain"
                    />
                  </div>
                ) : (
                  <div className="h-32 rounded-lg bg-slate-50 border-2 border-dashed border-slate-300 overflow-hidden">
                    <SignatureCanvas
                      ref={empSigRef}
                      penColor="#0f172a"
                      canvasProps={{
                        className: 'w-full h-32 cursor-crosshair'
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Manager Signature Pad */}
              <div className="bg-white rounded-xl p-3 border border-slate-200 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-700">
                    Manager Signature ({currentManager.name})
                  </span>
                  {!isReadOnlySigned && !existingWriteUp?.managerSignatureDataUrl && (
                    <button
                      type="button"
                      onClick={() => mgrSigRef.current?.clear()}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-700 flex items-center gap-1"
                    >
                      <Eraser className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                {existingWriteUp?.managerSignatureDataUrl ? (
                  <div className="h-32 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center p-2">
                    <img
                      src={existingWriteUp.managerSignatureDataUrl}
                      alt="Manager Signature"
                      className="max-h-28 object-contain"
                    />
                  </div>
                ) : (
                  <div className="h-32 rounded-lg bg-slate-50 border-2 border-dashed border-slate-300 overflow-hidden">
                    <SignatureCanvas
                      ref={mgrSigRef}
                      penColor="#1e1b4b"
                      canvasProps={{
                        className: 'w-full h-32 cursor-crosshair'
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-200/70 transition-colors"
          >
            Close
          </button>

          {!isReadOnlySigned && (
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveDraftPending}
                className="px-4 py-2.5 rounded-xl font-bold text-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Clock className="w-4 h-4" />
                Save as Pending Signature (Sign Next Shift)
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleFinalizeAndSign}
                className="px-5 py-2.5 rounded-xl font-black text-xs bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/20 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <UserCheck className="w-4 h-4" />
                {refusedToSign
                  ? 'Record Refusal & Finalize Write-Up'
                  : 'Finalize & Sign on Master iPad'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
