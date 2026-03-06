import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { InputBar } from "@/components/synthesis-ui/InputBar";
import { WorkspaceView } from "@/components/synthesis-ui/WorkspaceView";
import { SpaceDock } from "@/components/synthesis-ui/SpaceDock";
import { MenuBar } from "@/components/synthesis-ui/MenuBar";
import { SettingsView } from "@/components/synthesis-ui/SettingsView";
import { FileBrowserView } from "@/components/synthesis-ui/FileBrowserView";
import { Toast } from "@/components/synthesis-ui/Toast";
import { CommandPalette } from "@/components/synthesis-ui/CommandPalette";
import { GenerativeZone } from "@/components/synthesis-ui/GenerativeZone";
import { RecallView } from "@/components/synthesis-ui/RecallView";
import { ChatPanel } from "@/components/synthesis-ui/ChatPanel";
import { HolographicHUD } from "@/components/synthesis-ui/HolographicHUD";
import { OnboardingWizard } from "@/components/synthesis-ui/onboarding/OnboardingWizard";
import { ProfileUnlockScreen } from "@/components/synthesis-ui/ProfileUnlockScreen";
import { JarvisButton } from "@/components/synthesis-ui/JarvisButton";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { SpaceId } from "@/types/synthesis";
import { LoginView } from "@/components/synthesis-ui/LoginView";
import { useSynthesisNodesFromStore } from "@/hooks/useSynthesisNodesFromStore";
import { useSynthesis } from "@/hooks/useSynthesis";
import { SyncStateProvider } from "@/context/SyncStateContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useLiquidGlass } from "@/hooks/useLiquidGlass";
import type { InputBarHandle, InputMode } from "@/components/synthesis-ui/InputBar";
import { getMetrics } from "@/lib/agent/metrics";



function AuthenticatedApp() {
    const { settings } = useSettings();
    const nodeStore = useSynthesisNodesFromStore(settings);
    const synthesis = useSynthesis(nodeStore, settings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsSectionRequest, setSettingsSectionRequest] = useState<string | null>(null);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [recallOpen, setRecallOpen] = useState(false);
    const [chatOpen, setChatOpen] = useState(false);
    const [inputMode, setInputMode] = useState<InputMode>("task");
    const [focusMode, setFocusMode] = useState(false);
    const [edgeHover, setEdgeHover] = useState(false);
    const [hudOpen, setHudOpen] = useState(false);
    const [fileBrowserOpen, setFileBrowserOpen] = useState(false);

    const edgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const toggleFocusMode = useCallback(() => {
        setFocusMode(prev => !prev);
        setEdgeHover(false);
    }, []);

    const exitFocusMode = useCallback(() => {
        setFocusMode(false);
        setEdgeHover(false);
    }, []);

    useEffect(() => {
        if (!focusMode) return;
        const handleMouseMove = (e: MouseEvent) => {
            const EDGE = 60;
            const nearEdge = e.clientX < EDGE || e.clientY < EDGE ||
                e.clientX > window.innerWidth - EDGE || e.clientY > window.innerHeight - EDGE;
            if (nearEdge) {
                if (edgeTimeoutRef.current) { clearTimeout(edgeTimeoutRef.current); edgeTimeoutRef.current = null; }
                setEdgeHover(true);
            } else {
                if (!edgeTimeoutRef.current) {
                    edgeTimeoutRef.current = setTimeout(() => {
                        setEdgeHover(false);
                        edgeTimeoutRef.current = null;
                    }, 800);
                }
            }
        };
        window.addEventListener("mousemove", handleMouseMove);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            if (edgeTimeoutRef.current) clearTimeout(edgeTimeoutRef.current);
        };
    }, [focusMode]);

    const showChrome = !focusMode || edgeHover;

    // Sync visibility with focus mode (CSS dock handles this via showChrome)

    const [agentMetrics, setAgentMetrics] = useState<{
        tasksStarted: number;
        tasksCompleted: number;
        tasksFailed: number;
        avgStepsPerTask: number;
        avgDurationMs: number;
        toolCallCounts: Record<string, number>;
        approvalRate: number;
    } | null>(null);

    useEffect(() => {
        if (!settings.debugMode) {
            setAgentMetrics(null);
            return;
        }
        const fetchMetrics = () => {
            try {
                const data = getMetrics();
                setAgentMetrics(data);
            } catch {
                setAgentMetrics(null);
            }
        };
        fetchMetrics();
        const interval = setInterval(fetchMetrics, 4000);
        return () => clearInterval(interval);
    }, [settings.debugMode]);

    const inputBarRef = useRef<InputBarHandle>(null);

    const {
        nodes,
        activeNodeId,
        activeSpaceId,
        activeSpaceNodes,
        nodeCountBySpace,
        hasVisibleNodes,
        activateNode,
        closeNode,
        minimizeNode,
        moveNode,
        resizeNode,
        toggleGodMode,
        switchSpace,
        spawnWidget,
        activeSpaceEdges,
        linkMode,
        startLinkMode,
        completeLinkMode,
        cancelLinkMode,
        removeEdge,
        getSpaceHistory,
        getOsHistory,
        getHistoryForNode,
        syncFailed,
        retrySync,
    } = nodeStore;

    const activeThinkingNode = useMemo(() => {
        const thinkingNodes = activeSpaceNodes.filter(
            (node) => node.status === "synthesizing" && node.type !== "agent_task",
        );
        if (thinkingNodes.length === 0) return null;
        return thinkingNodes.reduce((latest, node) =>
            (node.updatedAt > latest.updatedAt ? node : latest)
        );
    }, [activeSpaceNodes]);

    const activeAgentTaskNode = useMemo(() => {
        const taskNodes = activeSpaceNodes.filter((node) => {
            if (node.type !== "agent_task") return false;
            return (
                node.status === "synthesizing" ||
                node.taskStatus === "planning" ||
                node.taskStatus === "running" ||
                node.taskStatus === "waiting_approval" ||
                node.taskStatus === "waiting_answer"
            );
        });
        if (taskNodes.length === 0) return null;
        return taskNodes.reduce((latest, node) =>
            (node.updatedAt > latest.updatedAt ? node : latest)
        );
    }, [activeSpaceNodes]);

    const activeTask = activeAgentTaskNode ? nodeStore.getTaskForNode(activeAgentTaskNode.id) : null;
    const isWaitingForAnswer = activeAgentTaskNode?.taskStatus === "waiting_answer";
    const pendingQuestionStep = activeTask?.steps.findLast((s) =>
        s.status === "waiting_answer" || s.type === "question_for_user"
    ) || activeTask?.steps[activeTask.steps.length - 1];

    const activeProgressNode = activeThinkingNode ?? activeAgentTaskNode;
    const activeProgressLogs = activeProgressNode?.content.logs ?? [];
    const activeProgressStep = activeProgressLogs.length > 0
        ? activeProgressLogs[activeProgressLogs.length - 1]
        : undefined;

    const {
        handleSearch,
        handleQuery,
        handleOsQuery,
        handleApproveStep,
        handleRejectStep,
        handleAnswerStep,
        handleCancelTask,
        cancelAllActive,
        isLoading,
        error,
        setError,
        successMsg,
        setSuccessMsg,
        ephemeralToasts,
        dismissEphemeralToast,
        pendingChatMessage,
        consumePendingChatMessage,
        missingApiKeyProvider,
        clearMissingApiKeyPrompt,
    } = synthesis;

    useEffect(() => {
        if (pendingChatMessage) {
            setChatOpen(true);
            consumePendingChatMessage();
        }
    }, [pendingChatMessage, consumePendingChatMessage]);

    const useAgent = settings.agentMode !== false;

    const handleSubmit = useCallback((query: string, targetNodeId?: string, forceMode?: "os" | "task") => {
        if (isWaitingForAnswer && activeTask && pendingQuestionStep) {
            void handleAnswerStep(activeTask.id, pendingQuestionStep.id, query);
            return;
        }
        const effectiveMode = forceMode ?? inputMode;
        if (effectiveMode === "os" && useAgent) {
            void handleOsQuery(query);
            return;
        }
        if (useAgent) {
            void handleQuery(query, targetNodeId);
        } else {
            void handleSearch(query);
        }
    }, [inputMode, useAgent, handleQuery, handleOsQuery, handleSearch, isWaitingForAnswer, activeTask, pendingQuestionStep, handleAnswerStep, activeNodeId]);

    const handleContinueFromCard = useCallback(
        (nodeId: string, message: string) => {
            const node = nodes.find((n) => n.id === nodeId);
            let title = node?.title ?? "Card";
            // Strip any existing "[About: ...]" prefixes from the title to prevent nesting
            title = title.replace(/^\[About:.*?\]\s*/g, "").trim();
            const query = `[About: ${title}]\n\n${message}`;
            handleSubmit(query, nodeId);
        },
        [nodes, handleSubmit],
    );

    const minimizeAll = useCallback(() => {
        const spaceNodes = nodeStore.activeSpaceNodes.filter((n) => n.status !== "minimized");
        for (const n of spaceNodes) {
            minimizeNode(n.id);
        }
    }, [nodeStore.activeSpaceNodes, minimizeNode]);

    const handleDropUrl = useCallback((url: string) => {
        void handleSubmit(url);
    }, [handleSubmit]);

    const handleDropFile = useCallback((file: File) => {
        const { type, name } = file;
        if (type.startsWith("image/")) {
            const objectUrl = URL.createObjectURL(file);
            nodeStore.addNode({
                query: `Dropped image: ${name}`,
                type: "note",
                title: name,
                spaceId: activeSpaceId,
                content: {
                    title: name,
                    summary: `Dropped image file: ${name}`,
                    blocks: [
                        { type: "hero_image", url: objectUrl, caption: name },
                        {
                            type: "data_grid",
                            items: [
                                { label: "Name", value: name },
                                { label: "Type", value: type },
                                { label: "Size", value: `${(file.size / 1024).toFixed(1)} KB` },
                            ],
                        },
                    ],
                    design: { accent_color: "#7BD4FF", glass_opacity: 0.4, text_style: "sans", vibe: "cosmic" },
                    sources: [],
                    logs: [`Image dropped: ${name}`],
                },
            });
            return;
        }
        if (type === "text/plain" || type === "text/markdown" || name.endsWith(".md") || name.endsWith(".txt")) {
            const reader = new FileReader();
            reader.onload = () => {
                const text = reader.result as string;
                nodeStore.addNode({
                    query: `Dropped file: ${name}`,
                    type: "note",
                    title: name,
                    spaceId: activeSpaceId,
                    content: {
                        title: name,
                        summary: text.slice(0, 200) + (text.length > 200 ? "..." : ""),
                        blocks: [
                            { type: "text_block", style: "caption", content: name },
                            { type: "text_block", style: "body", content: text },
                        ],
                        design: { accent_color: "#34d399", glass_opacity: 0.4, text_style: "mono", vibe: "focused" },
                        sources: [],
                        logs: [`File read: ${name} (${(file.size / 1024).toFixed(1)} KB)`],
                    },
                });
            };
            reader.readAsText(file);
            return;
        }
        void handleSubmit(`Analyze the file: ${name} (${type})`);
    }, [nodeStore, activeSpaceId, handleSubmit]);

    useKeyboardShortcuts({
        onFocusInput: () => {
            if (commandPaletteOpen) setCommandPaletteOpen(false);
            else if (inputBarRef.current?.isFocused()) setCommandPaletteOpen(true);
            else inputBarRef.current?.focus();
        },
        onCloseActiveNode: () => { if (activeNodeId) closeNode(activeNodeId); },
        onSwitchSpace: (spaceId) => { switchSpace(spaceId); setError(null); },
        onCloseSettings: () => { setSettingsOpen(false); setCommandPaletteOpen(false); },
        onOpenSettings: () => setSettingsOpen(true),
        onToggleGodMode: () => { if (activeNodeId) toggleGodMode(activeNodeId); },
        onMinimizeAll: minimizeAll,
        onToggleFocusMode: toggleFocusMode,
        onExitFocusMode: exitFocusMode,
        isFocusMode: focusMode,
        isSettingsOpen: settingsOpen || commandPaletteOpen,
        settings,
    });

    const baseResolutionScale = useMemo(() => {
        if (settings.resolution === "4k") return 1.2;
        if (settings.resolution === "1440") return 1.1;
        return 1;
    }, [settings.resolution]);

    const systemFontScale = useMemo(() => {
        const scaleBySize: Record<"x-small" | "small" | "medium" | "large" | "x-large", number> = {
            "x-small": 0.92, small: 0.97, medium: 1, large: 1.06, "x-large": 1.12,
        };
        return scaleBySize[settings.systemFontSize] ?? 1;
    }, [settings.systemFontSize]);

    useEffect(() => {
        const handleGlobalSelectStart = (e: Event) => {
            const target = e.target as HTMLElement;
            if (!(target instanceof Element)) return;
            if (!target.closest(".select-text") && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
                e.preventDefault();
            }
        };
        window.addEventListener("selectstart", handleGlobalSelectStart);
        return () => window.removeEventListener("selectstart", handleGlobalSelectStart);
    }, []);

    return (
        <>
            {syncFailed && (
                <div className="fixed top-0 left-0 right-0 z-[3000] flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/20 border-b border-amber-500/40 text-amber-200 text-sm">
                    <span>Workspace could not be loaded. Check the connection to the server (backend on the Mac).</span>
                    <button
                        type="button"
                        onClick={() => retrySync()}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/30 hover:bg-amber-500/50 border border-amber-500/50 text-amber-100 text-xs font-medium transition-colors"
                    >
                        Retry
                    </button>
                </div>
            )}
            <main
                role="main"
                className="fixed inset-0 w-full h-full min-w-0 min-h-0 overflow-hidden selection:bg-cyan-400/30 select-none"
                style={{
                    fontSize: `${baseResolutionScale * systemFontScale * 100}%`,
                    backgroundColor: "var(--synthesis-bg, #060a1a)",
                    width: "100vw",
                    height: "100dvh",
                }}
                onPointerDown={(e) => {
                    const target = e.target as HTMLElement;
                    if (!(target instanceof Element)) return;
                    if ((target === e.currentTarget || target.closest('[role="main"]')) && !target.closest(".select-text")) {
                        window.getSelection()?.removeAllRanges();
                    }
                }}
            >
                <motion.div
                    animate={{ opacity: showChrome ? 1 : 0, y: showChrome ? 0 : -20 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    style={{ pointerEvents: showChrome ? "auto" : "none" }}
                >
                    <MenuBar
                        spaceId={activeSpaceId}
                        nodeCount={activeSpaceNodes.filter((n) => n.status !== "minimized").length}
                        isLoading={isLoading}
                        activeSynthCount={synthesis.activeSynthCount}
                    />
                    <GenerativeZone
                        widgets={nodeStore.ephemeralWidgets}
                        onDismiss={nodeStore.dismissEphemeralWidget}
                        enabled={settings.widgetsEnabled}
                    />
                </motion.div>

                <WorkspaceView
                    nodes={nodes}
                    activeNodeId={activeNodeId}
                    spaceId={activeSpaceId}
                    spaceLabel={settings.spaces.find(s => s.id === activeSpaceId)?.label ?? activeSpaceId}
                    onActivate={activateNode}
                    onClose={closeNode}
                    onMinimize={minimizeNode}
                    onMove={moveNode}
                    onResize={resizeNode}
                    onToggleGodMode={toggleGodMode}
                    edges={activeSpaceEdges}
                    linkMode={linkMode}
                    onStartLink={startLinkMode}
                    onCompleteLink={completeLinkMode}
                    onCancelLink={cancelLinkMode}
                    onRemoveEdge={removeEdge}
                    onDropUrl={handleDropUrl}
                    onDropFile={handleDropFile}
                    getTaskForNode={nodeStore.getTaskForNode}
                    getTaskById={nodeStore.getTaskById}
                    onApproveStep={handleApproveStep}
                    onRejectStep={handleRejectStep}
                    onAnswerStep={handleAnswerStep}
                    onCancelTask={handleCancelTask}
                    onContinueFromCard={handleContinueFromCard}
                />

                <AnimatePresence>
                    {focusMode && !edgeHover && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 0.3 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.6 }}
                            className="fixed inset-0 z-[15] bg-black pointer-events-none"
                        />
                    )}
                </AnimatePresence>

                <motion.div
                    animate={{ opacity: showChrome ? 1 : 0, x: showChrome ? 0 : -30 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    style={{ pointerEvents: showChrome ? "auto" : "none" }}
                >
                    <SpaceDock
                        activeSpaceId={activeSpaceId}
                        nodeCountBySpace={nodeCountBySpace}
                        onSelectSpace={(spaceId) => { switchSpace(spaceId); setError(null); }}
                        onOpenSettings={() => setSettingsOpen(true)}
                        onSpawnWidget={spawnWidget}
                        onToggleRecall={() => setRecallOpen(true)}
                        onToggleChat={() => setChatOpen(true)}
                        onSynthesize={handleSubmit}
                        onFocusInput={() => inputBarRef.current?.focus()}
                        onToggleHUD={() => setHudOpen(prev => !prev)}
                        onOpenFileBrowser={() => setFileBrowserOpen(true)}
                    />
                </motion.div>

                <RecallView
                    isOpen={recallOpen}
                    onClose={() => setRecallOpen(false)}
                    nodes={nodes}
                    onActivateNode={(id) => activateNode(id)}
                />

                <ChatPanel
                    isOpen={chatOpen}
                    onClose={() => setChatOpen(false)}
                    activeSpaceId={activeSpaceId}
                    history={
                        inputMode === "os"
                            ? getOsHistory()
                            : activeNodeId
                                ? getHistoryForNode(activeSpaceId, activeNodeId)
                                : getSpaceHistory(activeSpaceId)
                    }
                    historySource={
                        inputMode === "os"
                            ? "os"
                            : activeNodeId
                                ? "node"
                                : "space"
                    }
                    focusedNode={nodes.find((n) => n.id === activeNodeId) ?? null}
                    onSubmit={handleSubmit}
                />

                <SettingsView
                    isOpen={settingsOpen}
                    onClose={() => {
                        setSettingsOpen(false);
                        setSettingsSectionRequest(null);
                    }}
                    initialSectionId={settingsSectionRequest ?? undefined}
                    spaceId={activeSpaceId}
                    nodes={nodes}
                    onCloseNode={closeNode}
                    onActivateNode={activateNode}
                    onCleanupStuckNodes={nodeStore.cleanupStuckNodes}
                    onCloseAllSpaceNodes={nodeStore.closeAllSpaceNodes}
                />

                <FileBrowserView
                    isOpen={fileBrowserOpen}
                    onClose={() => setFileBrowserOpen(false)}
                />

                <CommandPalette
                    isOpen={commandPaletteOpen}
                    onClose={() => setCommandPaletteOpen(false)}
                    nodes={nodes}
                    onActivateNode={activateNode}
                    onSwitchSpace={(spaceId) => { switchSpace(spaceId); setError(null); }}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onToggleGodMode={() => { if (activeNodeId) toggleGodMode(activeNodeId); }}
                    onMinimizeAll={minimizeAll}
                    onSearch={handleSubmit}
                    onSpawnEphemeral={(type) => nodeStore.spawnEphemeralWidget(type)}
                    onToggleFocusMode={toggleFocusMode}
                />

                <div
                    className={`fixed z-[2000] flex flex-col gap-2 pointer-events-none ${settings.notifPosition === "top-center"
                        ? "top-10 left-1/2 -translate-x-1/2"
                        : settings.notifPosition === "bottom-right"
                            ? "bottom-10 right-4"
                            : "top-10 right-4"
                        }`}
                >
                    <AnimatePresence>
                        {error && settings.notifs && (
                            <Toast
                                message={error.message}
                                details={error.details}
                                onDismiss={() => setError(null)}
                                onRetry={error.query ? () => { if (error.query) void handleSubmit(error.query); } : undefined}
                            />
                        )}
                        {ephemeralToasts.map((toast) => (
                            <Toast
                                key={toast.id}
                                variant="ephemeral"
                                message={toast.text}
                                onDismiss={() => dismissEphemeralToast(toast.id)}
                                duration={5000}
                            />
                        ))}
                        {successMsg && settings.notifs && (
                            <motion.div
                                initial={{ opacity: 0, y: -20, x: 20, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -10, x: 20, scale: 0.95 }}
                                transition={{ type: "spring", stiffness: 400, damping: 30 }}
                                className="pointer-events-auto max-w-sm w-full"
                            >
                                <div className="glass-elevated rounded-xl p-3.5 border-emerald-400/20">
                                    <div className="flex items-center gap-3">
                                        <Sparkles size={16} className="text-emerald-400 shrink-0" />
                                        <p className="text-sm font-medium text-emerald-200 flex-1">{successMsg}</p>
                                        <button
                                            onClick={() => setSuccessMsg(null)}
                                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 transition-colors shrink-0"
                                        >
                                            <X size={13} />
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <AnimatePresence>
                    {hudOpen && (
                        <HolographicHUD
                            spaceId={activeSpaceId}
                            nodeCount={activeSpaceNodes.filter((n) => n.status !== "minimized").length}
                            activeSynthCount={synthesis.activeSynthCount}
                            agentMetrics={agentMetrics}
                        />
                    )}
                </AnimatePresence>

                {settings.debugMode && (
                    <div className="fixed bottom-2 left-2 z-[2100] text-[9px] font-mono text-white/30 bg-black/40 backdrop-blur-sm rounded-lg px-3 py-2 pointer-events-auto space-y-1 max-w-[320px]">
                        <p className="pointer-events-none">
                            Nodes: {nodes.length} | Visible: {activeSpaceNodes.filter((n) => n.status !== "minimized").length}
                        </p>
                        <p className="pointer-events-none">
                            Model: {settings.aiModel} | Temp: {settings.temperature / 100}
                        </p>
                        <button
                            onClick={() => import("@/lib/apiClient").then(({ kernelInvoke }) => kernelInvoke("test_concurrency")).catch(console.error)}
                            className="mt-1 px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-white/70 w-full text-center cursor-pointer transition-colors"
                        >
                            Run Multi-Agent Load Test
                        </button>
                    </div>
                )}
                <OnboardingWizard
                    getOsHistory={nodeStore.getOsHistory}
                    onOsQuery={(q) => synthesis.handleOsQuery(q)}
                    isLoading={synthesis.isLoading}
                />
                <ProfileUnlockScreen />

                {missingApiKeyProvider === "openai" && (
                    <div className="fixed inset-0 z-[3200] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm">
                        <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0b1220]/95 p-5 shadow-2xl">
                            <h3 className="text-[15px] font-semibold text-white">Missing OpenAI API key</h3>
                            <p className="mt-2 text-[12px] leading-relaxed text-white/70">
                                The agent cannot respond because there is no valid API key for OpenAI.
                                Configure it in <span className="text-white font-medium">Settings → AI Engine</span>.
                            </p>
                            <div className="mt-4 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => clearMissingApiKeyPrompt()}
                                    className="px-3 py-1.5 rounded-lg border border-white/20 text-[11px] text-white/80 hover:bg-white/10 transition-colors"
                                >
                                    Close
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSettingsSectionRequest("ai");
                                        setSettingsOpen(true);
                                        clearMissingApiKeyPrompt();
                                    }}
                                    className="px-3 py-1.5 rounded-lg bg-[var(--synthesis-accent)] text-[11px] font-medium text-white hover:opacity-90 transition-opacity"
                                >
                                    Go to AI Engine
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Input bar outside main - always on top */}
            <div
                className="flex justify-center px-4 z-[9999]"
                style={{
                    position: "fixed",
                    bottom: 32,
                    left: 0,
                    right: 0,
                    top: "auto",
                    pointerEvents: showChrome ? "auto" : "none",
                }}
            >
                <div className="w-full max-w-2xl mx-auto">
                    <InputBar
                        ref={inputBarRef}
                        onSubmit={handleSubmit}
                        onCancel={cancelAllActive}
                        mode={inputMode}
                        onModeChange={setInputMode}
                        activeNodeTitle={null}
                        isLoading={isLoading}
                        isWaitingForInput={isWaitingForAnswer}
                        waitingQuestionText={isWaitingForAnswer ? pendingQuestionStep?.reasoning ?? undefined : undefined}
                        compact={hasVisibleNodes}
                        spaceId={activeSpaceId}
                        showThinkingBanner={!isWaitingForAnswer}
                        thinkingQuery={activeProgressNode?.query}
                        thinkingStep={activeProgressStep}
                        thinkingStepsCount={activeProgressLogs.length}
                        thinkingSteps={activeProgressLogs}
                        agentSteps={activeTask?.steps}
                        thinkingPhase={activeProgressNode?.thinkingPhase}
                        streamingReasoning={activeProgressNode?.content?.streamingReasoning}
                        streamingContent={activeProgressNode?.content?.streamingContent}
                    />
                </div>
            </div>
            <JarvisButton />
        </>
    );
}

export default function App() {
    useLiquidGlass();
    const { isAuthenticated, isLoading: authLoading } = useAuth();

    if (!authLoading && !isAuthenticated) {
        return <LoginView />;
    }
    return (
        <SyncStateProvider>
            <AuthenticatedApp />
        </SyncStateProvider>
    );
}
