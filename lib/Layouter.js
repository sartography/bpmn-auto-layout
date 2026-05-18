import { BpmnModdle } from 'bpmn-moddle';
import { isBoundaryEvent, isConnection } from './utils/elementUtils.js';
import { DEFAULT_CELL_HEIGHT, DEFAULT_CELL_WIDTH } from './utils/layoutUtil.js';
import { Grid } from './Grid.js';
import { DiFactory } from './di/DiFactory.js';
import { is, getDefaultSize } from './di/DiUtil.js';
import { handlers } from './handler/index.js';
import { isFunction } from 'min-dash';

export class Layouter {
  constructor() {
    this.moddle = new BpmnModdle();
    this.diFactory = new DiFactory(this.moddle);
    this._handlers = handlers;
  }

  handle(operation, options) {
    return this._handlers
      .filter(handler => isFunction(handler[operation]))
      .map(handler => handler[operation](options));

  }

  async layoutProcess(xml) {
    const moddleObj = await this.moddle.fromXML(xml);
    const { rootElement } = moddleObj;

    this.diagram = rootElement;

    const firstRootProcess = this.getProcess();

    if (firstRootProcess) {

      this.setExpandedPropertyToModdleElements(moddleObj);

      this.setExecutedProcesses(firstRootProcess);

      this.createGridsForProcesses();

      this.cleanDi();

      this.createRootDi(firstRootProcess);

      this.drawProcesses();
    }

    return (await this.moddle.toXML(this.diagram, { format: true })).xml;
  }

  createGridsForProcesses() {
    const processes = this.layoutedProcesses.sort((a, b) => b.level - a.level);

    // create and add grids for each process
    // root processes should be processed last for element expanding
    for (const process of processes) {

      // add base grid with collapsed elements
      process.grid = this.createGridLayout(process);

      expandGridHorizontally(process.grid);
      expandGridVertically(process.grid);

      if (process.isExpanded) {
        const [ rowCount, colCount ] = process.grid.getGridDimensions();
        if (rowCount === 0) process.grid.createRow();
        if (colCount === 0) process.grid.createCol();
      }

    }
  }

  setExpandedPropertyToModdleElements(bpmnModel) {
    const allElements = bpmnModel.elementsById;
    if (allElements) {
      for (const element of Object.values(allElements)) {
        if (element.$type === 'bpmndi:BPMNShape' && element.isExpanded === true) element.bpmnElement.isExpanded = true;
        if (element.$type === 'bpmndi:BPMNPlane' && is(element.bpmnElement, 'bpmn:SubProcess') && element.planeElement?.length) {
          element.bpmnElement.hasOwnPlane = true;
        }
      }
    }
  }

  setExecutedProcesses(firstRootProcess) {
    this.layoutedProcesses = [];

    const executionStack = [ firstRootProcess ];

    while (executionStack.length > 0) {
      const executedProcess = executionStack.pop();
      this.layoutedProcesses.push(executedProcess);
      executedProcess.level = executedProcess.$parent === this.diagram ? 0 : executedProcess.$parent.level + 1;

      const nextProcesses = executedProcess.get('flowElements').filter(flowElement => is(flowElement, 'bpmn:SubProcess'));

      executionStack.splice(executionStack.length, 0, ...nextProcesses);
    }
  }

  cleanDi() {
    this.diagram.diagrams = [];
  }

  createGridLayout(root) {
    const grid = new Grid();

    const flowElements = [ ...(root.flowElements || []), ...(root.artifacts || []) ];
    const elements = flowElements.filter(el => !is(el,'bpmn:SequenceFlow')
      && !is(el, 'bpmn:Association')
      && !isDataElement(el)
      && !is(el, 'bpmn:DataObject'));
    grid.dataElements = flowElements.filter(isDataElement);

    // check for empty process/subprocess
    if (!flowElements) {
      return grid;
    }

    bindBoundaryEventsWithHosts (flowElements);
    bindTextAnnotationAssociations(flowElements);
    bindDataAssociations(flowElements);

    // Depth-first-search
    const visited = new Set();
    let disconnectedFlowNodeRow = null;
    while (visited.size < elements.filter(element => !element.attachedToRef).length) {
      const startingElements = elements.filter(el => {
        return !isConnection(el) &&
            !isBoundaryEvent(el) &&
            (!el.incoming || !hasOtherIncoming(el)) &&
            !visited.has(el);
      });
      const connectedStartingElements = startingElements.filter(el => !isDisconnectedFlowNode(root, el));
      const disconnectedStartingElements = startingElements.filter(el => isDisconnectedFlowNode(root, el));
      const elementsToAdd = connectedStartingElements.length > 0 ? connectedStartingElements : disconnectedStartingElements;

      const stack = [ ...elementsToAdd ];

      elementsToAdd.forEach((el, index) => {
        if (isDisconnectedFlowNode(root, el)) {
          disconnectedFlowNodeRow = addToGridStartOrAfterExistingGrid(grid, el, disconnectedFlowNodeRow);
        } else {
          grid.add(el);
        }
        visited.add(el);
      });

      this.handleGrid(grid,visited,stack);

      if (grid.getElementsTotal() !== elements.length) {
        const gridElements = grid.getAllElements();
        const missingElements = elements.filter(el => !gridElements.includes(el) && !isBoundaryEvent(el));
        if (missingElements.length > 0) {
          const missingElement = missingElements[0];
          stack.push(missingElement);
          if (isAnnotatedDisconnectedFlowNode(root, missingElement)) {
            addAnnotatedDisconnectedFlowNode(grid, missingElement, visited);
          } else if (isDisconnectedFlowNode(root, missingElement)) {
            disconnectedFlowNodeRow = addToGridStartOrAfterExistingGrid(grid, missingElement, disconnectedFlowNodeRow);
          } else {
            grid.add(missingElement);
          }
          visited.add(missingElement);
          this.handleGrid(grid,visited,stack);
        }
      }
    }
    return grid;
  }

  generateDi(layoutGrid , shift, procDi) {
    const diFactory = this.diFactory;

    const prePlaneElement = procDi ? procDi : this.diagram.diagrams[0];

    const planeElement = prePlaneElement.plane.get('planeElement');

    // Step 1: Create DI for all elements
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createElementDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });

    // Step 2: Create DI for all connections
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this
        .handle('createConnectionDi', { element, row, col, layoutGrid, diFactory, shift })
        .flat();

      planeElement.push(...dis);
    });

    const associations = layoutGrid.getAllElements()
      .flatMap(element => element.associations || [])
      .filter(association => association.sourceRef?.di && association.targetRef?.di);

    associations.forEach(association => {
      planeElement.push(diFactory.createDiEdge(association, connectAssociation(association.sourceRef, association.targetRef), {
        id: association.id + '_di'
      }));
    });

    const dataElements = (layoutGrid.dataElements || [])
      .filter(dataElement => dataElement.associatedFlowNodes?.some(node => node.di));

    dataElements.forEach(dataElement => {
      const bounds = getDataElementBounds(dataElement);

      if (!bounds) {
        return;
      }

      const shapeDi = diFactory.createDiShape(dataElement, bounds, {
        id: dataElement.id + '_di'
      });
      dataElement.di = shapeDi;
      planeElement.push(shapeDi);
    });

    const dataAssociations = [ ...new Set(dataElements.flatMap(dataElement => dataElement.dataAssociations || [])) ]
      .filter(association => association.sourceElement?.di && association.targetElement?.di);

    dataAssociations.forEach(association => {
      planeElement.push(diFactory.createDiEdge(association, connectDataAssociation(association.sourceElement, association.targetElement), {
        id: association.id + '_di'
      }));
    });
  }

  handleGrid(grid, visited, stack) {
    while (stack.length > 0) {
      const currentElement = stack.pop();

      const nextElements = this.handle('addToGrid', { element: currentElement, grid, visited, stack });

      nextElements.flat().forEach(el => {
        stack.push(el);
        visited.add(el);
      });
    }
  }

  getProcess() {
    return this.diagram.get('rootElements').find(el => el.$type === 'bpmn:Process');
  }

  createRootDi(processes) {
    this.createProcessDi(processes);
  }

  createProcessDi(element) {
    const diFactory = this.diFactory;

    const planeDi = diFactory.createDiPlane({
      id: 'BPMNPlane_' + element.id,
      bpmnElement: element
    });
    const diagramDi = diFactory.createDiDiagram({
      id: 'BPMNDiagram_' + element.id,
      plane: planeDi
    });

    const diagram = this.diagram;

    diagram.diagrams.push(diagramDi);

    return diagramDi;
  }

  /**
   * Draw processes.
   * Root processes should be processed first for element expanding
   */
  drawProcesses() {
    const sortedProcesses = this.layoutedProcesses.sort((a, b) => a.level - b.level);

    for (const process of sortedProcesses) {
      if (process.level > 0 && !process.isExpanded) {
        if (process.hasOwnPlane) {
          const diagram = this.createProcessDi(process);
          this.generateDi(process.grid, { x: 0, y: 0 }, diagram);
        }
        continue;
      }

      // draw processes in expanded elements
      if (process.isExpanded) {
        const baseProcDi = this.getElementDi(process);
        if (!baseProcDi) {
          continue;
        }
        const diagram = this.getProcDi(baseProcDi);
        let { x, y } = baseProcDi.bounds;
        const { width, height } = getDefaultSize(process);
        x += DEFAULT_CELL_WIDTH / 2 - width / 4;
        y += DEFAULT_CELL_HEIGHT - height - height / 4;
        this.generateDi(process.grid, { x, y }, diagram);
        continue;
      }

      // draw other processes
      const diagram = this.diagram.diagrams.find(diagram => diagram.plane.bpmnElement === process);
      this.generateDi(process.grid, { x: 0, y: 0 }, diagram);
    }
  }

  getElementDi(element) {
    return this.diagram.diagrams
      .map(diagram => diagram.plane.planeElement).flat()
      .find(item => item.bpmnElement === element);
  }

  getProcDi(element) {
    return this.diagram.diagrams.find(diagram => diagram.plane.planeElement.includes(element));
  }
}

export function bindBoundaryEventsWithHosts(elements) {
  const boundaryEvents = elements.filter(element => isBoundaryEvent(element));
  boundaryEvents.forEach(boundaryEvent => {
    const attachedTask = boundaryEvent.attachedToRef;
    const attachers = attachedTask.attachers || [];
    attachers.push(boundaryEvent);
    attachedTask.attachers = attachers;
  });
}

export function bindTextAnnotationAssociations(elements) {
  const associations = elements.filter(element => is(element, 'bpmn:Association'));
  associations.forEach(association => {
    if (!association.sourceRef || !association.targetRef) {
      return;
    }

    const associations = association.sourceRef.associations || [];
    associations.push(association);
    association.sourceRef.associations = associations;

    if (is(association.targetRef, 'bpmn:TextAnnotation')) {
      association.sourceRef.hasTextAnnotationAssociation = true;
      association.targetRef.annotationSource = association.sourceRef;
    }
  });
}

export function bindDataAssociations(elements) {
  elements.forEach(element => {
    (element.dataInputAssociations || []).forEach(association => {
      (association.sourceRef || [])
        .filter(isDataElement)
        .forEach(source => bindDataAssociation(association, source, element));
    });

    (element.dataOutputAssociations || []).forEach(association => {
      if (isDataElement(association.targetRef)) {
        bindDataAssociation(association, element, association.targetRef);
      }
    });
  });
}

function bindDataAssociation(association, source, target) {
  association.sourceElement = source;
  association.targetElement = target;

  [ source, target ].filter(isDataElement).forEach(dataElement => {
    const associatedFlowNode = isDataElement(source) ? target : source;
    const dataAssociations = dataElement.dataAssociations || [];
    const associatedFlowNodes = dataElement.associatedFlowNodes || [];

    dataAssociations.push(association);
    associatedFlowNodes.push(associatedFlowNode);

    dataElement.dataAssociations = [ ...new Set(dataAssociations) ];
    dataElement.associatedFlowNodes = [ ...new Set(associatedFlowNodes) ];
  });
}

function connectAssociation(source, target) {
  const sourceBounds = source.di.get('bounds');
  const targetBounds = target.di.get('bounds');
  const sourceMidY = sourceBounds.y + sourceBounds.height / 2;
  const targetMidY = targetBounds.y + targetBounds.height / 2;
  const sourceMidX = sourceBounds.x + sourceBounds.width / 2;
  const targetMidX = targetBounds.x + targetBounds.width / 2;

  if (targetMidX < sourceMidX) {
    return [
      { x: sourceBounds.x, y: sourceMidY },
      { x: targetBounds.x + targetBounds.width, y: targetMidY }
    ];
  }

  return [
    { x: sourceBounds.x + sourceBounds.width, y: sourceMidY },
    { x: targetBounds.x, y: targetMidY }
  ];
}

function connectDataAssociation(source, target) {
  const sourceBounds = source.di.get('bounds');
  const targetBounds = target.di.get('bounds');
  const sourceCenter = getCenter(sourceBounds);
  const targetCenter = getCenter(targetBounds);

  if (sourceCenter.y < targetCenter.y) {
    return [
      { x: sourceCenter.x, y: sourceBounds.y + sourceBounds.height },
      { x: targetCenter.x, y: targetBounds.y }
    ];
  }

  return [
    { x: sourceCenter.x, y: sourceBounds.y },
    { x: targetCenter.x, y: targetBounds.y + targetBounds.height }
  ];
}

function getDataElementBounds(dataElement) {
  const associatedBounds = [ ...new Set(dataElement.associatedFlowNodes || []) ]
    .filter(node => node.di)
    .map(node => node.di.get('bounds'));

  if (associatedBounds.length === 0) {
    return null;
  }

  const { width, height } = getDefaultSize(dataElement);
  const centerX = associatedBounds
    .map(bounds => bounds.x + bounds.width / 2)
    .reduce((sum, x) => sum + x, 0) / associatedBounds.length;
  const maxBottom = Math.max(...associatedBounds.map(bounds => bounds.y + bounds.height));

  return {
    width,
    height,
    x: Math.round(centerX - width / 2),
    y: maxBottom + 45
  };
}

function getCenter(bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

function isDataElement(element) {
  return is(element, 'bpmn:DataObjectReference') || is(element, 'bpmn:DataStoreReference');
}

/**
 * Check grid by columns.
 * If column has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid horizontally.
 * @param grid
 */
function expandGridHorizontally(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();
  for (let i = maxCols - 1 ; i >= 0; i--) {
    const elementsInCol = [];
    for (let j = 0; j < numRows; j++) {
      const candidate = grid.get(j, i);
      if (candidate && candidate.isExpanded) elementsInCol.push(candidate);
    }

    if (elementsInCol.length === 0) continue;

    const maxColCount = elementsInCol.reduce((acc,cur) => {
      const [ ,curCols ] = cur.grid.getGridDimensions();
      if (acc === undefined || curCols > acc) return curCols;
      return acc;
    }, undefined);

    const shift = !maxColCount ? 2 : maxColCount;
    grid.createCol(i, shift);
  }
}

/**
 * Check grid by rows.
 * If row has elements with isExpanded === true,
 * find the maximum size of elements grids and expand the parent grid vertically.
 * @param grid
 */
function expandGridVertically(grid) {
  const [ numRows , maxCols ] = grid.getGridDimensions();

  for (let i = numRows - 1 ; i >= 0; i--) {
    const elementsInRow = [];
    for (let j = 0; j < maxCols; j++) {
      const candidate = grid.get(i, j);
      if (candidate && candidate.isExpanded) elementsInRow.push(candidate);
    }

    if (elementsInRow.length === 0) continue;

    const maxRowCount = elementsInRow.reduce((acc,cur) => {
      const [ curRows ] = cur.grid.getGridDimensions();
      if (acc === undefined || curRows > acc) return curRows;
      return acc;
    }, undefined);

    const shift = !maxRowCount ? 1 : maxRowCount;

    // expand the parent grid vertically
    for (let index = 0; index < shift; index++) {
      grid.createRow(i);
    }
  }
}

function hasOtherIncoming(element) {
  const fromHost = element.incoming?.filter(edge => edge.sourceRef !== element && edge.sourceRef.attachedToRef === undefined) || [];

  const fromAttached = element.incoming?.filter(edge => edge.sourceRef !== element
      && edge.sourceRef.attachedToRef !== element);

  return fromHost?.length > 0 || fromAttached?.length > 0;
}

function isDisconnectedFlowNode(root, element) {
  return root.level === 0
    && is(element, 'bpmn:FlowNode')
    && !element.triggeredByEvent
    && !element.isExpanded
    && !element.incoming?.length
    && !element.outgoing?.length;
}

function isAnnotatedDisconnectedFlowNode(root, element) {
  return isDisconnectedFlowNode(root, element) && element.hasTextAnnotationAssociation;
}

function addToGridStartOrAfterExistingGrid(grid, element, disconnectedFlowNodeRow) {
  const [ rowCount, colCount ] = grid.getGridDimensions();

  if (grid.getElementsTotal() === 0) {
    grid.add(element);
    return 0;
  }

  const row = disconnectedFlowNodeRow ?? rowCount;
  grid.add(element, [ row, colCount ]);

  return row;
}

function addAnnotatedDisconnectedFlowNode(grid, element, visited) {
  const [ rowCount, colCount ] = grid.getGridDimensions();
  const row = grid.getElementsTotal() === 0 ? 0 : rowCount;
  const col = Math.min(1, Math.max(0, colCount - 1));
  const yOffset = -(row + 1) * DEFAULT_CELL_HEIGHT;

  element.layoutOffset = {
    ...(element.layoutOffset || {}),
    y: yOffset
  };

  const annotation = element.associations
    ?.map(association => association.targetRef)
    .find(target => is(target, 'bpmn:TextAnnotation'));

  if (annotation && col > 0) {
    annotation.layoutOffset = {
      ...(annotation.layoutOffset || {}),
      y: yOffset - 85
    };
    grid.add(annotation, [ row, col - 1 ]);
    visited.add(annotation);
  }

  grid.add(element, [ row, col ]);
}
