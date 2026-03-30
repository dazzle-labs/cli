//! Incremental DOM rendering: applies style mutations from JS command buffer
//! to a persistent layout tree, avoiding full HTML reparse + cascade.
//!
//! Phase 1: only inline style mutations (el.style.X = Y) are handled incrementally.
//! Structural changes (appendChild/removeChild) fall back to full re-render.

use tiny_skia::Pixmap;

use super::layout::LayoutNode;
use super::style::{self, ComputedStyle, Viewport};
use super::paint;

/// Persistent DOM node for incremental updates.
#[derive(Debug, Clone)]
pub struct PersistentNode {
    pub tag: String,
    pub style: ComputedStyle,
    pub text: Option<String>,
    pub children: Vec<usize>, // indices into PersistentDom.nodes
    pub parent: Option<usize>,
    pub svg_data: Option<String>,
    pub image_data: Option<Vec<u8>>,
    pub image_natural_size: Option<(u32, u32)>,
    /// Set when a style mutation targets this SVG node or a descendant.
    /// Triggers a full re-render fallback since SVG needs re-serialization.
    pub svg_dirty: bool,
}

/// The persistent DOM tree — flat storage indexed by node_id.
/// Bootstrapped from the initial HTML render's StyledNode tree.
pub struct PersistentDom {
    pub nodes: Vec<Option<PersistentNode>>,
    /// Mapping from _dz_id (JS) to our node index. For the initial render,
    /// we don't have JS IDs — we use sequential indices.
    pub taffy_tree: taffy::TaffyTree<()>,
    pub taffy_ids: Vec<Option<taffy::NodeId>>,
    pub root_id: Option<taffy::NodeId>,
    pub viewport: Viewport,
}

impl PersistentDom {
    /// Bootstrap from a LayoutNode tree (result of initial HTML render).
    pub fn from_layout_tree(root: &LayoutNode, vp: Viewport) -> Self {
        let mut dom = PersistentDom {
            nodes: Vec::new(),
            taffy_tree: taffy::TaffyTree::new(),
            taffy_ids: Vec::new(),
            root_id: None,
            viewport: vp,
        };

        let root_idx = dom.add_node_recursive(root);
        dom.root_id = dom.taffy_ids.get(root_idx).copied().flatten();

        // Compute initial layout
        if let Some(root_taffy) = dom.root_id {
            let _ = dom.taffy_tree.compute_layout(
                root_taffy,
                taffy::Size {
                    width: taffy::AvailableSpace::Definite(vp.w),
                    height: taffy::AvailableSpace::Definite(vp.h),
                },
            );
        }

        dom
    }

    fn add_node_recursive(&mut self, node: &LayoutNode) -> usize {
        let idx = self.nodes.len();
        let persistent = PersistentNode {
            tag: node.tag.clone().unwrap_or_default(),
            style: node.style.clone(),
            text: node.text.clone(),
            children: Vec::new(),
            parent: None,
            svg_data: node.svg_data.clone(),
            image_data: node.image_data.clone(),
            image_natural_size: node.image_natural_size,
            svg_dirty: false,
        };
        self.nodes.push(Some(persistent));
        self.taffy_ids.push(None); // placeholder

        // Build taffy node
        let taffy_style = super::layout::to_taffy_style_pub(&node.style, self.viewport);

        // Recursively add children
        let child_indices: Vec<usize> = node.children.iter()
            .map(|child| {
                let ci = self.add_node_recursive(child);
                if let Some(ref mut parent_node) = self.nodes[idx] {
                    parent_node.children.push(ci);
                }
                if let Some(ref mut child_node) = self.nodes[ci] {
                    child_node.parent = Some(idx);
                }
                ci
            })
            .collect();

        // Create taffy node with children
        let child_taffy_ids: Vec<taffy::NodeId> = child_indices.iter()
            .filter_map(|&ci| self.taffy_ids.get(ci).copied().flatten())
            .collect();

        let taffy_id = if child_taffy_ids.is_empty() {
            // Leaf — set text/image dimensions
            let mut s = taffy_style;
            if let Some(ref text) = node.text {
                if matches!(node.style.width, style::Dimension::Auto) {
                    let text_width = super::layout::estimate_text_width_pub(text, node.style.font_size);
                    s.size.width = taffy::Dimension::length(text_width);
                }
                if matches!(node.style.height, style::Dimension::Auto) {
                    s.size.height = taffy::Dimension::length(node.style.font_size * node.style.line_height);
                }
            }
            self.taffy_tree.new_leaf(s).ok()
        } else {
            self.taffy_tree.new_with_children(taffy_style, &child_taffy_ids).ok()
        };

        self.taffy_ids[idx] = taffy_id;
        idx
    }

    /// Apply a style mutation to a node and update its taffy style.
    /// Returns true if the mutation was applied (node exists).
    pub fn apply_style_mutation(&mut self, node_id: usize, property: &str, value: &str) -> bool {
        // Check node exists
        if !matches!(self.nodes.get(node_id), Some(Some(_))) {
            return false;
        }

        // Apply the CSS property to the node's computed style
        if let Some(Some(node)) = self.nodes.get_mut(node_id) {
            style::apply_declaration(&mut node.style, property, value);
        }

        // Mark SVG nodes dirty: check self and walk up to SVG root
        {
            let has_svg = self.nodes.get(node_id)
                .and_then(|n| n.as_ref())
                .map_or(false, |n| n.svg_data.is_some());
            if has_svg {
                if let Some(Some(n)) = self.nodes.get_mut(node_id) {
                    n.svg_dirty = true;
                }
            }

            // Walk up ancestors to find SVG root
            let mut idx = self.nodes.get(node_id)
                .and_then(|n| n.as_ref())
                .and_then(|n| n.parent);
            while let Some(pidx) = idx {
                let (has_svg, next_parent) = self.nodes.get(pidx)
                    .and_then(|n| n.as_ref())
                    .map_or((false, None), |n| (n.svg_data.is_some(), n.parent));
                if has_svg {
                    if let Some(Some(pnode)) = self.nodes.get_mut(pidx) {
                        pnode.svg_dirty = true;
                    }
                    break;
                }
                idx = next_parent;
            }
        }

        // Update the taffy style
        if let Some(Some(taffy_id)) = self.taffy_ids.get(node_id) {
            let new_style = super::layout::to_taffy_style_pub(
                &self.nodes[node_id].as_ref().unwrap().style, self.viewport);
            let _ = self.taffy_tree.set_style(*taffy_id, new_style);
        }

        true
    }

    /// Recompute layout and paint to a pixmap.
    /// Returns `true` if SVG nodes are dirty and a full re-render is needed
    /// (the persistent DOM can't re-serialize SVG markup).
    pub fn layout_and_paint(&mut self, pixmap: &mut Pixmap) -> bool {
        // Check if any SVG node is dirty — requires full re-render fallback
        let svg_dirty = self.nodes.iter().any(|n| {
            n.as_ref().map_or(false, |node| node.svg_dirty && node.svg_data.is_some())
        });

        if svg_dirty {
            // Clear dirty flags for next frame
            for node in self.nodes.iter_mut().flatten() {
                node.svg_dirty = false;
            }
            return true; // caller should do full re-render
        }

        if let Some(root_id) = self.root_id {
            let _ = self.taffy_tree.compute_layout(
                root_id,
                taffy::Size {
                    width: taffy::AvailableSpace::Definite(self.viewport.w),
                    height: taffy::AvailableSpace::Definite(self.viewport.h),
                },
            );
        }

        // Extract layout tree and paint
        if let (Some(root_taffy), Some(Some(_))) = (self.root_id, self.nodes.first()) {
            let layout_root = self.extract_layout(0, root_taffy, 0.0, 0.0);
            paint::paint(&layout_root, pixmap);
        }
        false
    }

    /// Extract a LayoutNode tree from the persistent DOM + taffy layout results.
    fn extract_layout(&self, node_idx: usize, taffy_id: taffy::NodeId, parent_x: f32, parent_y: f32) -> LayoutNode {
        let node = match &self.nodes[node_idx] {
            Some(n) => n,
            None => return empty_layout_node(parent_x, parent_y),
        };

        let layout = match self.taffy_tree.layout(taffy_id) {
            Ok(l) => l,
            Err(_) => return empty_layout_node(parent_x, parent_y),
        };

        let x = parent_x + layout.location.x;
        let y = parent_y + layout.location.y;

        let taffy_children = self.taffy_tree.children(taffy_id).unwrap_or_default();
        let children: Vec<LayoutNode> = node.children.iter()
            .zip(taffy_children.iter())
            .map(|(&child_idx, &child_taffy)| {
                self.extract_layout(child_idx, child_taffy, x, y)
            })
            .collect();

        LayoutNode {
            bounds: style::Rect { x, y, w: layout.size.width, h: layout.size.height },
            style: node.style.clone(),
            text: node.text.clone(),
            tag: Some(node.tag.clone()),
            svg_data: node.svg_data.clone(),
            image_data: node.image_data.clone(),
            image_natural_size: node.image_natural_size,
            children,
        }
    }

    /// Collect layout rects for all nodes: Vec<(node_id, x, y, w, h)>.
    /// x,y are absolute positions (accumulated from parent offsets).
    pub fn collect_layout_rects(&self) -> Vec<(usize, f32, f32, f32, f32)> {
        let mut rects = Vec::new();
        if let Some(root_id) = self.root_id {
            self.collect_rects_recursive(0, root_id, 0.0, 0.0, &mut rects);
        }
        rects
    }

    fn collect_rects_recursive(
        &self,
        node_idx: usize,
        taffy_id: taffy::NodeId,
        parent_x: f32,
        parent_y: f32,
        rects: &mut Vec<(usize, f32, f32, f32, f32)>,
    ) {
        if let Ok(layout) = self.taffy_tree.layout(taffy_id) {
            let x = parent_x + layout.location.x;
            let y = parent_y + layout.location.y;
            let w = layout.size.width;
            let h = layout.size.height;
            rects.push((node_idx, x, y, w, h));

            if let Some(Some(node)) = self.nodes.get(node_idx) {
                let taffy_children = self.taffy_tree.children(taffy_id).unwrap_or_default();
                for (i, &child_taffy) in taffy_children.iter().enumerate() {
                    if let Some(&child_idx) = node.children.get(i) {
                        self.collect_rects_recursive(child_idx, child_taffy, x, y, rects);
                    }
                }
            }
        }
    }
}

fn empty_layout_node(x: f32, y: f32) -> LayoutNode {
    LayoutNode {
        bounds: style::Rect { x, y, w: 0.0, h: 0.0 },
        style: ComputedStyle::default(),
        text: None,
        tag: None,
        svg_data: None,
        image_data: None,
        image_natural_size: None,
        children: vec![],
    }
}
