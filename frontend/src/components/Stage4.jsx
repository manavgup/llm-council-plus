import { useState } from 'react';
import Skeleton from './common/Skeleton';
import { getModelVisuals, getShortModelName } from '../utils/modelHelpers';
import ThinkBlockRenderer from './ThinkBlockRenderer';
import StageTimer from './StageTimer';
import './Stage4.css';

/**
 * Convert [REVISED ...] and [NEW ...] markers into styled markdown.
 * The CSS classes .marker-revised / .marker-new render as pill badges,
 * and .revised-text / .new-text add a dashed underline highlight.
 */
function highlightRevisionMarkers(text) {
    if (!text) return text;
    return text
        .replace(/\[REVISED[:\s]*/gi, '<span class="marker-revised">REVISED</span> <span class="revised-text">')
        .replace(/\[NEW[:\s]*/gi, '<span class="marker-new">NEW</span> <span class="new-text">')
        .replace(/\](?=\s|$|\.)/g, '</span>');
}

/** Count occurrences of [REVISED] and [NEW] markers in text */
function countMarkers(text) {
    if (!text) return { revised: 0, newSections: 0 };
    const revised = (text.match(/\[REVISED/gi) || []).length;
    const newSections = (text.match(/\[NEW/gi) || []).length;
    return { revised, newSections };
}

/** Strip [REVISED ...] and [NEW ...] tags for clean clipboard copy */
function stripMarkers(text) {
    if (!text) return '';
    return text
        .replace(/\[REVISED[:\s]*/gi, '')
        .replace(/\[NEW[:\s]*/gi, '')
        .replace(/\](?=\s|$|\.)/g, '');
}

/**
 * Build claims-addressed summary from round data.
 * Compares first-round and last-round verdicts to determine action taken.
 */
function buildClaimsSummary(rounds) {
    if (!rounds || rounds.length < 2) return null;

    const claimRounds = rounds.filter(rd => {
        const mode = rd.metadata?.critique_mode || rd.critique_mode;
        return mode === 'claim';
    });
    if (claimRounds.length < 1) return null;

    const firstRound = claimRounds[0];
    const lastRound = claimRounds[claimRounds.length - 1];

    const firstVerdicts = firstRound.metadata?.aggregate_claim_verdicts || {};
    const lastVerdicts = lastRound.metadata?.aggregate_claim_verdicts || {};
    const claims = lastRound.metadata?.canonical_claims || firstRound.metadata?.canonical_claims || {};
    const l2m = lastRound.metadata?.label_to_model || firstRound.metadata?.label_to_model || {};

    const summary = [];
    for (const [label, claimList] of Object.entries(claims)) {
        for (const claim of claimList) {
            const first = firstVerdicts[claim.id]?.majority_verdict;
            const last = lastVerdicts[claim.id]?.majority_verdict;

            let action;
            if (first && first !== 'strong' && last === 'strong') {
                action = 'revised'; // was contested, now strong
            } else if (first === 'strong' && last === 'strong') {
                action = 'kept'; // always strong
            } else if (!first && last) {
                action = 'revised'; // appeared mid-deliberation
            } else {
                action = 'revised'; // still contested = was revised (with caveats)
            }

            summary.push({
                id: claim.id,
                claim: claim.claim,
                action,
                lastVerdict: last,
                sourceModel: l2m[label] || label,
            });
        }
    }

    return summary.length > 0 ? summary : null;
}

export default function Stage4({ correctedDraft, startTime, endTime, rounds }) {
    const [isCopied, setIsCopied] = useState(false);
    const [showClaims, setShowClaims] = useState(false);

    if (!correctedDraft) return null;

    const visuals = getModelVisuals(correctedDraft?.model);
    const shortName = getShortModelName(correctedDraft?.model);

    const rawText = typeof correctedDraft?.response === 'string'
        ? correctedDraft.response
        : String(correctedDraft?.response || '');

    const { revised, newSections } = countMarkers(rawText);
    const claimsSummary = buildClaimsSummary(rounds);

    const handleCopy = async () => {
        const cleanText = stripMarkers(rawText);
        if (!cleanText) return;
        try {
            await navigator.clipboard.writeText(cleanText);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    };

    const markedContent = highlightRevisionMarkers(rawText) || 'No corrected draft generated.';

    return (
        <div className="stage-container stage-4">
            <div className="stage-header">
                <div className="stage-title">
                    <span className="stage-icon">&#x1F4DD;</span>
                    Stage 4: Corrected Draft
                </div>
                <StageTimer startTime={startTime} endTime={endTime} label="Duration" />
            </div>

            <div className="corrected-draft-section">
                {/* Banner */}
                <div className="draft-banner">
                    <div className="draft-banner-avatar" style={{ backgroundColor: visuals.color }}>
                        {visuals.icon}
                    </div>
                    <div className="draft-banner-info">
                        <div className="draft-banner-title">
                            <span>&#x1F451;</span> Chairman's Corrected Draft
                        </div>
                        <div className="draft-banner-subtitle">
                            The chairman has rewritten the document incorporating corrections from deliberation.
                            {(revised > 0 || newSections > 0) && (
                                <> Changes are marked with{' '}
                                    {revised > 0 && <span className="marker-revised">REVISED</span>}
                                    {revised > 0 && newSections > 0 && ' and '}
                                    {newSections > 0 && <span className="marker-new">NEW</span>}
                                    {' '}inline.</>
                            )}
                        </div>
                    </div>
                    <span className="draft-banner-model">{shortName}</span>
                    <button
                        className={`draft-copy-btn ${isCopied ? 'copied' : ''}`}
                        onClick={handleCopy}
                        title="Copy clean text (without markers) to clipboard"
                    >
                        {isCopied ? (
                            <><span>&#x2714;</span> Copied</>
                        ) : (
                            <><span>&#x1F4CB;</span> Copy Draft</>
                        )}
                    </button>
                </div>

                {/* Stats bar */}
                {(revised > 0 || newSections > 0) && (
                    <div className="draft-stats-bar">
                        {revised > 0 && (
                            <div className="draft-stat">
                                <span>&#x1F527;</span>
                                <span className="draft-stat-value">{revised}</span>
                                {' '}revision{revised !== 1 ? 's' : ''}
                            </div>
                        )}
                        {newSections > 0 && (
                            <div className="draft-stat">
                                <span>&#x2795;</span>
                                <span className="draft-stat-value">{newSections}</span>
                                {' '}new section{newSections !== 1 ? 's' : ''}
                            </div>
                        )}
                    </div>
                )}

                {/* Document body */}
                <div className="draft-document markdown-content">
                    <ThinkBlockRenderer content={markedContent} allowHtml />
                </div>

                {/* Claims Addressed Summary */}
                {claimsSummary && (
                    <div className="draft-claims-footer">
                        <button
                            className="draft-claims-toggle"
                            onClick={() => setShowClaims(!showClaims)}
                        >
                            <span className="toggle-icon">{showClaims ? '&#x25BE;' : '&#x25B8;'}</span>
                            <span>&#x1F4CB;</span>
                            <span className="draft-claims-toggle-text">
                                Claims Addressed in This Draft
                            </span>
                            <span className="draft-claims-count">{claimsSummary.length} claims</span>
                        </button>

                        {showClaims && (
                            <div className="draft-claims-list">
                                {claimsSummary.map(c => (
                                    <div key={c.id} className="claim-ref">
                                        <span className={`claim-ref-id ${c.lastVerdict || ''}`}>{c.id}</span>
                                        <span className={`claim-ref-action ${c.action}`}>
                                            {c.action.charAt(0).toUpperCase() + c.action.slice(1)}
                                        </span>
                                        <span className="claim-ref-text">&ldquo;{c.claim}&rdquo;</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export function Stage4Skeleton() {
    return (
        <div className="stage-container stage-4 skeleton-mode">
            <div className="stage-header">
                <div className="stage-title">
                    <span className="stage-icon">&#x1F4DD;</span>
                    Stage 4: Corrected Draft
                </div>
                <div className="stage-timer-skeleton"><Skeleton variant="text" width="60px" /></div>
            </div>
            <div className="corrected-draft-section">
                <div className="draft-banner">
                    <Skeleton variant="avatar" />
                    <div style={{ gap: '4px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <Skeleton variant="text" width="200px" height="1.2em" />
                        <Skeleton variant="text" width="300px" height="0.8em" />
                    </div>
                </div>
                <div className="draft-document" style={{ padding: '24px' }}>
                    <Skeleton variant="text" width="100%" />
                    <Skeleton variant="text" width="95%" />
                    <Skeleton variant="text" width="90%" />
                    <Skeleton variant="text" width="97%" />
                    <br />
                    <Skeleton variant="text" width="100%" />
                    <Skeleton variant="text" width="88%" />
                </div>
            </div>
        </div>
    );
}
