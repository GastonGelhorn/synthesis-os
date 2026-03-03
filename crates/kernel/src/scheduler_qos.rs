use crate::syscall::{Priority, Syscall};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::time::Instant;

/// Extended scheduling policies for QoS and fair-share
#[derive(Debug, Clone)]
pub enum QosPolicy {
    /// Weighted Fair Queuing - each agent gets proportional share based on weight
    WeightedFairQueue {
        weights: HashMap<String, f64>,
        default_weight: f64,
    },
    /// Deficit Round Robin - agents accumulate credits per round
    DeficitRoundRobin {
        quantum: u64, // credits per round
        deficits: HashMap<String, i64>,
    },
    /// Priority with aging - prevents starvation by boosting old requests
    PriorityWithAging {
        age_threshold_ms: u64, // after this, promote priority
        aging_boost: u8,       // priority levels to boost
    },
}

/// Syscall wrapper with timing metadata for QoS tracking
#[derive(Debug)]
pub struct QueuedSyscall {
    pub syscall: Syscall,
    pub enqueued_at: Instant,
    pub original_priority: Priority,
    pub effective_priority: Priority,
    pub wait_ms: u64,
}

/// Per-agent queue metadata for QoS tracking
pub struct AgentQueueMeta {
    pub agent_id: String,
    pub queue: VecDeque<QueuedSyscall>,
    pub total_served: u64,
    pub total_wait_ms: u64,
    pub weight: f64,
    pub deficit: i64,
    pub last_served: Option<Instant>,
    pub starvation_count: u64,
    pub virtual_time: f64,
}

impl AgentQueueMeta {
    pub fn new(agent_id: String, weight: f64) -> Self {
        Self {
            agent_id,
            queue: VecDeque::new(),
            total_served: 0,
            total_wait_ms: 0,
            weight,
            deficit: 0,
            last_served: None,
            starvation_count: 0,
            virtual_time: 0.0,
        }
    }
}

/// QoS metrics for monitoring and observability
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QosMetrics {
    pub p50_wait_ms: u64,
    pub p95_wait_ms: u64,
    pub p99_wait_ms: u64,
    pub starvation_events: u64,
    pub total_served: u64,
    pub queue_depths: HashMap<String, usize>,
    pub agent_fairness_ratio: f64, // 1.0 = perfectly fair
    pub active_agents: usize,
    pub total_queued: usize,
}

/// Backpressure signal from the scheduler
#[derive(Debug, Clone)]
pub enum BackpressureAction {
    Accept,
    Throttle { delay_ms: u64 },
    Reject { reason: String },
}

/// Main QoS Scheduler
pub struct QosScheduler {
    agents: HashMap<String, AgentQueueMeta>,
    policy: QosPolicy,
    max_queue_depth: usize,
    wait_times: Vec<u64>, // for percentile calculation
    total_queued: u64,
    last_aging: Instant,
    aging_interval_ms: u64,
}

impl QosScheduler {
    /// Create a new QoS scheduler with specified policy
    pub fn new(policy: QosPolicy, max_queue_depth: usize) -> Self {
        Self {
            agents: HashMap::new(),
            policy,
            max_queue_depth,
            wait_times: Vec::new(),
            total_queued: 0,
            last_aging: Instant::now(),
            aging_interval_ms: 100,
        }
    }

    /// Enqueue a syscall, applying backpressure if needed
    pub fn enqueue(&mut self, agent_id: &str, syscall: Syscall) -> BackpressureAction {
        let queue_depth: usize = self.agents.values().map(|m| m.queue.len()).sum();

        // Backpressure check
        if queue_depth >= self.max_queue_depth {
            return BackpressureAction::Reject {
                reason: format!("Queue full: {} >= {}", queue_depth, self.max_queue_depth),
            };
        }

        let priority = match &syscall {
            Syscall::LlmRequest { priority, .. } => *priority,
            Syscall::ToolRequest { priority, .. } => *priority,
            _ => Priority::Normal,
        };

        let queue_meta = self.agents.entry(agent_id.to_string()).or_insert_with(|| {
            let weight = match &self.policy {
                QosPolicy::WeightedFairQueue {
                    weights,
                    default_weight,
                } => weights.get(agent_id).copied().unwrap_or(*default_weight),
                _ => 1.0,
            };
            AgentQueueMeta::new(agent_id.to_string(), weight)
        });

        let queued = QueuedSyscall {
            syscall,
            enqueued_at: Instant::now(),
            original_priority: priority,
            effective_priority: priority,
            wait_ms: 0,
        };

        queue_meta.queue.push_back(queued);
        self.total_queued += 1;

        BackpressureAction::Accept
    }

    /// Dequeue the next syscall based on active policy
    pub fn dequeue(&mut self) -> Option<Syscall> {
        // Update aging if interval has elapsed
        if self.last_aging.elapsed().as_millis() as u64 >= self.aging_interval_ms {
            self.update_aging();
            self.last_aging = Instant::now();
        }

        let agent_id = match &self.policy {
            QosPolicy::WeightedFairQueue { .. } => self.wfq_select(),
            QosPolicy::DeficitRoundRobin { .. } => self.drr_select(),
            QosPolicy::PriorityWithAging { .. } => self.priority_aging_select(),
        }?;

        if let Some(meta) = self.agents.get_mut(&agent_id) {
            if let Some(mut queued) = meta.queue.pop_front() {
                let wait_ms = queued.enqueued_at.elapsed().as_millis() as u64;
                queued.wait_ms = wait_ms;

                meta.total_served += 1;
                meta.total_wait_ms += wait_ms;
                meta.last_served = Some(Instant::now());

                self.wait_times.push(wait_ms);

                // Clean up empty agents
                if meta.queue.is_empty() {
                    self.agents.remove(&agent_id);
                }

                return Some(queued.syscall);
            }
        }

        None
    }

    /// Select next agent for Weighted Fair Queuing
    fn wfq_select(&mut self) -> Option<String> {
        let mut best_agent = None;
        let mut best_vft = f64::MAX;

        for (agent_id, meta) in self.agents.iter_mut() {
            if !meta.queue.is_empty() {
                // Virtual Finish Time = virtual_time + 1 / weight
                let vft = meta.virtual_time + (1.0 / meta.weight);
                if vft < best_vft {
                    best_vft = vft;
                    best_agent = Some(agent_id.clone());
                }
            }
        }

        if let Some(agent_id) = &best_agent {
            if let Some(meta) = self.agents.get_mut(agent_id) {
                meta.virtual_time = best_vft;
            }
        }

        best_agent
    }

    /// Select next agent for Deficit Round Robin
    fn drr_select(&mut self) -> Option<String> {
        let agents: Vec<String> = self
            .agents
            .iter()
            .filter(|(_, m)| !m.queue.is_empty())
            .map(|(id, _)| id.clone())
            .collect();

        for agent_id in agents.iter() {
            if let Some(meta) = self.agents.get_mut(agent_id) {
                if meta.deficit <= 0 {
                    meta.deficit = match &self.policy {
                        QosPolicy::DeficitRoundRobin { quantum, .. } => *quantum as i64,
                        _ => 1,
                    };
                }

                if !meta.queue.is_empty() {
                    meta.deficit -= 1;
                    return Some(agent_id.clone());
                }
            }
        }

        None
    }

    /// Select next agent using priority with aging
    fn priority_aging_select(&mut self) -> Option<String> {
        let mut best_agent = None;
        let mut best_priority = Priority::Low;

        for (agent_id, meta) in self.agents.iter() {
            if !meta.queue.is_empty() {
                if let Some(queued) = meta.queue.front() {
                    if queued.effective_priority > best_priority {
                        best_priority = queued.effective_priority;
                        best_agent = Some(agent_id.clone());
                    }
                }
            }
        }

        best_agent
    }

    /// Update priorities based on age (called periodically)
    pub fn update_aging(&mut self) {
        let age_threshold = match &self.policy {
            QosPolicy::PriorityWithAging {
                age_threshold_ms, ..
            } => *age_threshold_ms,
            _ => return,
        };

        let aging_boost = match &self.policy {
            QosPolicy::PriorityWithAging { aging_boost, .. } => *aging_boost,
            _ => return,
        };

        for meta in self.agents.values_mut() {
            for queued in meta.queue.iter_mut() {
                if queued.enqueued_at.elapsed().as_millis() as u64 >= age_threshold {
                    // Boost priority, capped at Critical
                    queued.effective_priority = match queued.original_priority {
                        Priority::Low => {
                            if aging_boost >= 3 {
                                Priority::Critical
                            } else if aging_boost >= 2 {
                                Priority::High
                            } else {
                                Priority::Normal
                            }
                        }
                        Priority::Normal => {
                            if aging_boost >= 2 {
                                Priority::Critical
                            } else {
                                Priority::High
                            }
                        }
                        Priority::High => {
                            if aging_boost >= 1 {
                                Priority::Critical
                            } else {
                                Priority::High
                            }
                        }
                        Priority::Critical => Priority::Critical,
                    };

                    if queued.effective_priority > queued.original_priority {
                        meta.starvation_count += 1;
                    }
                }
            }
        }
    }

    /// Get current QoS metrics
    pub fn metrics(&self) -> QosMetrics {
        let mut queue_depths = HashMap::new();
        let mut total_served = 0u64;
        let mut starvation_events = 0u64;

        for (agent_id, meta) in self.agents.iter() {
            queue_depths.insert(agent_id.clone(), meta.queue.len());
            total_served += meta.total_served;
            starvation_events += meta.starvation_count;
        }

        let (p50, p95, p99) = self.calculate_percentiles();

        // Simple fairness ratio: ratio of max to min served
        let fairness_ratio = if total_served > 0 && !self.agents.is_empty() {
            let max_served = self
                .agents
                .values()
                .map(|m| m.total_served)
                .max()
                .unwrap_or(1);
            let min_served = self
                .agents
                .values()
                .map(|m| m.total_served)
                .min()
                .unwrap_or(1);
            if min_served > 0 {
                (max_served as f64) / (min_served as f64)
            } else {
                1.0
            }
        } else {
            1.0
        };

        QosMetrics {
            p50_wait_ms: p50,
            p95_wait_ms: p95,
            p99_wait_ms: p99,
            starvation_events,
            total_served,
            queue_depths,
            agent_fairness_ratio: fairness_ratio,
            active_agents: self.agents.len(),
            total_queued: self.agents.values().map(|m| m.queue.len()).sum(),
        }
    }

    /// Calculate percentiles from wait times
    fn calculate_percentiles(&self) -> (u64, u64, u64) {
        if self.wait_times.is_empty() {
            return (0, 0, 0);
        }

        let mut sorted = self.wait_times.clone();
        sorted.sort_unstable();

        let p50_idx = (sorted.len() / 2).max(0);
        let p95_idx = ((sorted.len() * 95) / 100).max(0);
        let p99_idx = ((sorted.len() * 99) / 100).max(0);

        (
            sorted.get(p50_idx).copied().unwrap_or(0),
            sorted.get(p95_idx).copied().unwrap_or(0),
            sorted.get(p99_idx).copied().unwrap_or(0),
        )
    }

    /// Set weight for an agent (WFQ mode)
    pub fn set_weight(&mut self, agent_id: &str, weight: f64) {
        if let Some(meta) = self.agents.get_mut(agent_id) {
            meta.weight = weight;
        } else {
            // Create entry if it doesn't exist
            let mut meta = AgentQueueMeta::new(agent_id.to_string(), weight);
            meta.weight = weight;
            self.agents.insert(agent_id.to_string(), meta);
        }
    }

    /// Change the scheduling policy at runtime
    pub fn set_policy(&mut self, policy: QosPolicy) {
        // Reset deficits/virtual times when changing policy
        for meta in self.agents.values_mut() {
            meta.deficit = 0;
            meta.virtual_time = 0.0;
        }
        self.policy = policy;
    }

    /// Get agent metadata (for debugging/monitoring)
    pub fn get_agent_meta(&self, agent_id: &str) -> Option<&AgentQueueMeta> {
        self.agents.get(agent_id)
    }

    /// Clear wait times history (for metrics reset)
    pub fn reset_metrics(&mut self) {
        self.wait_times.clear();
        for meta in self.agents.values_mut() {
            meta.total_wait_ms = 0;
            meta.total_served = 0;
            meta.starvation_count = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backpressure_on_full_queue() {
        let mut scheduler = QosScheduler::new(
            QosPolicy::WeightedFairQueue {
                weights: HashMap::new(),
                default_weight: 1.0,
            },
            2, // max_queue_depth = 2
        );

        // Create mock syscalls
        let (tx1, rx1) = tokio::sync::oneshot::channel();
        let (tx2, rx2) = tokio::sync::oneshot::channel();
        let (tx3, rx3) = tokio::sync::oneshot::channel();

        let syscall1 = Syscall::LlmRequest {
            agent_id: "agent1".to_string(),
            priority: Priority::Normal,
            prompt: "test1".to_string(),
            response_tx: tx1,
            system_prompt: None,
            tool_definitions: None,
            model: None,
            stream: false,
            max_tokens: None,
            max_completion_tokens: None,
        };

        let syscall2 = Syscall::LlmRequest {
            agent_id: "agent1".to_string(),
            priority: Priority::Normal,
            prompt: "test2".to_string(),
            response_tx: tx2,
            system_prompt: None,
            tool_definitions: None,
            model: None,
            stream: false,
            max_tokens: None,
            max_completion_tokens: None,
        };

        let syscall3 = Syscall::LlmRequest {
            agent_id: "agent1".to_string(),
            priority: Priority::Normal,
            prompt: "test3".to_string(),
            response_tx: tx3,
            system_prompt: None,
            tool_definitions: None,
            model: None,
            stream: false,
            max_tokens: None,
            max_completion_tokens: None,
        };

        // First two should accept
        assert!(matches!(
            scheduler.enqueue("agent1", syscall1),
            BackpressureAction::Accept
        ));
        assert!(matches!(
            scheduler.enqueue("agent1", syscall2),
            BackpressureAction::Accept
        ));

        // Third should reject due to full queue
        assert!(matches!(
            scheduler.enqueue("agent1", syscall3),
            BackpressureAction::Reject { .. }
        ));
    }
}
