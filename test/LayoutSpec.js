import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { layoutProcess } from 'bpmn-auto-layout';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDirectory = path.join(__dirname, 'fixtures');
const outputDirectory = path.join(__dirname, 'output');
const snapshotsDirectory = path.join(__dirname, 'snapshots');

const UPDATE_SNAPSHOTS = process.env.UPDATE_SNAPSHOTS === 'true';


describe('Layout', function() {

  before(function() {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    if (UPDATE_SNAPSHOTS) {
      fs.rmSync(snapshotsDirectory, { recursive: true, force: true });
      fs.mkdirSync(snapshotsDirectory, { recursive: true });
    }
  });

  it('should not draw collapsed subprocess children in the parent plane', async function() {

    // given
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="SubProcess_1" />
    <bpmn:subProcess id="SubProcess_1">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
      <bpmn:startEvent id="NestedStart_1">
        <bpmn:outgoing>NestedFlow_1</bpmn:outgoing>
      </bpmn:startEvent>
      <bpmn:sequenceFlow id="NestedFlow_1" sourceRef="NestedStart_1" targetRef="NestedTask_1" />
      <bpmn:task id="NestedTask_1">
        <bpmn:incoming>NestedFlow_1</bpmn:incoming>
      </bpmn:task>
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="SubProcess_1" targetRef="EndEvent_1" />
    <bpmn:endEvent id="EndEvent_1">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`;

    // when
    const output = await layoutProcess(xml);

    // then
    assert.match(output, /<bpmndi:BPMNShape[^>]+bpmnElement="SubProcess_1"/);
    assert.doesNotMatch(output, /<bpmndi:BPMNShape[^>]+bpmnElement="NestedStart_1"/);
    assert.doesNotMatch(output, /<bpmndi:BPMNShape[^>]+bpmnElement="NestedTask_1"/);
    assert.doesNotMatch(output, /<bpmndi:BPMNEdge[^>]+bpmnElement="NestedFlow_1"/);
  });

  it('should ignore expanded descendants of collapsed subprocesses', async function() {

    // given
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="OuterSubProcess_1" />
    <bpmn:subProcess id="OuterSubProcess_1">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:subProcess id="InnerSubProcess_1">
        <bpmn:startEvent id="NestedStart_1" />
      </bpmn:subProcess>
    </bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_Process_1">
    <bpmndi:BPMNPlane id="BPMNPlane_Process_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="OuterSubProcess_1_di" bpmnElement="OuterSubProcess_1">
        <dc:Bounds x="100" y="100" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="InnerSubProcess_1_di" bpmnElement="InnerSubProcess_1" isExpanded="true">
        <dc:Bounds x="140" y="140" width="100" height="80" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    // when
    const output = await layoutProcess(xml);

    // then
    assert.match(output, /<bpmndi:BPMNShape[^>]+bpmnElement="OuterSubProcess_1"/);
    assert.doesNotMatch(output, /<bpmndi:BPMNShape[^>]+bpmnElement="InnerSubProcess_1"/);
    assert.doesNotMatch(output, /<bpmndi:BPMNShape[^>]+bpmnElement="NestedStart_1"/);
  });

  it('should place disconnected flow nodes after connected flow nodes', async function() {

    // given
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1" />
    <bpmn:task id="Task_1">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1" />
    <bpmn:endEvent id="EndEvent_1">
      <bpmn:incoming>Flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:task id="IsolatedTask_1" />
    <bpmn:task id="IsolatedTask_2" />
  </bpmn:process>
</bpmn:definitions>`;

    // when
    const output = await layoutProcess(xml);
    const bounds = boundsByElement(output);
    const connectedMaxX = bounds.EndEvent_1.x + bounds.EndEvent_1.width;

    // then
    assert.ok(bounds.IsolatedTask_1.x > connectedMaxX);
    assert.ok(bounds.IsolatedTask_2.x > connectedMaxX);
    assert.ok(bounds.IsolatedTask_1.y > bounds.EndEvent_1.y);
    assert.ok(bounds.IsolatedTask_2.y > bounds.EndEvent_1.y);
  });

  it('should keep the default gateway flow on the same row', async function() {

    // given
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1">
      <bpmn:outgoing>Flow_Start</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="StartEvent_1" targetRef="Gateway_1" />
    <bpmn:exclusiveGateway id="Gateway_1" default="Flow_Default">
      <bpmn:incoming>Flow_Start</bpmn:incoming>
      <bpmn:outgoing>Flow_No</bpmn:outgoing>
      <bpmn:outgoing>Flow_Default</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="Flow_No" name="No" sourceRef="Gateway_1" targetRef="Task_No" />
    <bpmn:task id="Task_No">
      <bpmn:incoming>Flow_No</bpmn:incoming>
    </bpmn:task>
    <bpmn:sequenceFlow id="Flow_Default" name="Yes" sourceRef="Gateway_1" targetRef="Task_Default" />
    <bpmn:task id="Task_Default">
      <bpmn:incoming>Flow_Default</bpmn:incoming>
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

    // when
    const output = await layoutProcess(xml);
    const bounds = boundsByElement(output);

    // then
    assert.ok(bounds.Task_Default.y < bounds.Task_No.y);
    assert.ok(bounds.Task_Default.x > bounds.Gateway_1.x);
  });

  fs.readdirSync(fixturesDirectory)
    .filter(fileName => fileName.endsWith('.bpmn'))
    .forEach(fileName => {
      iit(fileName)(`should layout ${ fileName }`, async function() {

        // given
        const xml = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

        // when
        const output = await layoutProcess(xml);

        fs.writeFileSync(path.join(outputDirectory, fileName), output, 'utf8');

        if (UPDATE_SNAPSHOTS) {
          fs.writeFileSync(path.join(snapshotsDirectory, fileName), output, 'utf8');
        } else if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
          const snapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');

          // then
          assert.strictEqual(output, snapshot, `Snapshot does not match output for ${ fileName }`);
        }
      });
    });


  after(function() {
    const results = fs.readdirSync(outputDirectory).filter(f => f.endsWith('.bpmn')).reduce((results, fileName) => {

      const diagram = fs.readFileSync(path.join(fixturesDirectory, fileName), 'utf8');

      const diagramOutput = fs.readFileSync(path.join(outputDirectory, fileName), 'utf8');

      let diagramSnapshot = null;

      if (fs.existsSync(path.join(snapshotsDirectory, fileName))) {
        diagramSnapshot = fs.readFileSync(path.join(snapshotsDirectory, fileName), 'utf8');
      }

      let diagramSnapshotMatching = null;

      if (diagramSnapshot) {

        if (diagramSnapshot === diagramOutput) {
          diagramSnapshotMatching = true;
        } else {
          diagramSnapshotMatching = false;

          console.error(`Snapshot does not match output for ${ fileName }`);
        }
      }

      return [
        ...results,
        {
          diagram,
          diagramOutput,
          diagramSnapshot,
          diagramSnapshotMatching,
          name: fileName
        }
      ];
    }, []);

    const template = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');

    const index = template.replace(
      /\/\* results-start \*\/[\s\S]*\/\* results-end \*\//,
      `const results = ${ JSON.stringify(results) };`
    );

    fs.writeFileSync(path.join(outputDirectory, 'index.html'), index, 'utf8');
  });

  this.afterAll(() => {
    console.log('\nRun `npm run test:inspect` to inspect results.');

    console.log('\nRun `npm run test:update-snapshots` to re-build snapshots.');
  });

});


/**
 * Return the matcher for the spec of the given name.
 *
 * @param {string} fileName
 * @return {any} mochaFN
 */
function iit(fileName) {
  if (fileName.startsWith('ONLY')) {
    return it.only;
  }

  if (fileName.startsWith('SKIP')) {
    return it.skip;
  }

  return it;
}

function boundsByElement(xml) {
  const bounds = {};
  const shapePattern = /<bpmndi:BPMNShape[^>]+bpmnElement="([^"]+)"[\s\S]*?<dc:Bounds x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g;

  for (const [ , elementId, x, y, width, height ] of xml.matchAll(shapePattern)) {
    bounds[elementId] = {
      height: Number(height),
      width: Number(width),
      x: Number(x),
      y: Number(y)
    };
  }

  return bounds;
}
