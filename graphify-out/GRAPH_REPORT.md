# Graph Report - task-buddy-mobile  (2026-10-27)

## Corpus Check
- 20 files · ~39,538 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 37 nodes · 36 edges · 7 communities (5 shown, 2 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0387d14c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- expo
- adaptiveIcon
- plugins
- LoginScreen
- [id].tsx
- experiments
- ios

## God Nodes (most connected - your core abstractions)
1. `expo` - 12 edges
2. `adaptiveIcon` - 5 edges
3. `android` - 3 edges
4. `plugins` - 3 edges
5. `expo-router` - 3 edges
6. `experiments` - 3 edges
7. `LoginScreen()` - 3 edges
8. `ios` - 2 edges
9. `formatDate()` - 2 edges
10. `TaskDetailScreen()` - 2 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (7 total, 2 thin omitted)

### Community 0 - "expo"
Cohesion: 0.22
Nodes (8): expo, icon, name, orientation, scheme, slug, userInterfaceStyle, version

### Community 1 - "adaptiveIcon"
Cohesion: 0.29
Nodes (7): backgroundColor, backgroundImage, foregroundImage, monochromeImage, adaptiveIcon, predictiveBackGestureEnabled, android

### Community 2 - "plugins"
Cohesion: 0.33
Nodes (4): plugins, expo-router, expo-secure-store, queryClient

### Community 4 - "[id].tsx"
Cohesion: 0.50
Nodes (3): formatDate(), styles, TaskDetailScreen()

### Community 5 - "experiments"
Cohesion: 0.67
Nodes (3): reactCompiler, typedRoutes, experiments

## Knowledge Gaps
- **19 isolated node(s):** `name`, `slug`, `version`, `orientation`, `icon` (+14 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `expo` connect `expo` to `adaptiveIcon`, `plugins`, `experiments`, `ios`?**
  _High betweenness centrality (0.611) - this node is a cross-community bridge._
- **Why does `plugins` connect `plugins` to `expo`?**
  _High betweenness centrality (0.348) - this node is a cross-community bridge._
- **Why does `expo-router` connect `plugins` to `[id].tsx`?**
  _High betweenness centrality (0.316) - this node is a cross-community bridge._
- **What connects `name`, `slug`, `version` to the rest of the system?**
  _19 weakly-connected nodes found - possible documentation gaps or missing edges._