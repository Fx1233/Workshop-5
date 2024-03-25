import bodyParser from "body-parser";
import express from "express";
import { delay } from "../utils";
import { error } from "console";
import { BASE_NODE_PORT } from "../config";
import { NodeState, Value } from "../types";




export async function node(
    nodeId: number,
    N: number, // total number of nodes in the network
    F: number, // number of faulty nodes in the network
    initialValue: Value,// initial value of the node
    isFaulty: boolean,
    nodesAreReady: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());




  let currentNodeState: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();



  
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });



// Route to stop the node
node.get("/stop", (req, res) => {
  currentNodeState.killed = true;
  res.status(200).json({ status: "killed" });
});






  // Route to get the current state of a node
  node.get("/getState", (req, res) => {
    res.status(200).send({
      killed: currentNodeState.killed,
      x: currentNodeState.x,
      decided: currentNodeState.decided,
      k: currentNodeState.k,
    });
  });

 



// Route to start the consensus algorithm
node.get("/start", async (req, res) => {
  // Attendre que tous les nœuds soient prêts
  while (!nodesAreReady()) {
    await delay(5);
  }

  if (!isFaulty) {
    // Configuration de l'état initial
    Object.assign(currentNodeState, { k: 1, x: initialValue, decided: false });

    // Création et exécution des promesses de fetch en parallèle
    const fetchPromises = Array.from({ length: N }, (_, i) =>
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          k: currentNodeState.k,
          x: currentNodeState.x,
          messageType: "propose"
        }),
      })
    );

    // Attendre la résolution de toutes les promesses
    await Promise.all(fetchPromises);
  } else {
    // Réinitialiser l'état pour les nœuds défectueux
    Object.assign(currentNodeState, { decided: null, x: null, k: null });
  }

  // Signaler que l'algorithme de consensus a démarré
  res.status(200).send("Consensus algorithm started.");
});



  // Route to receive messages
  node.post("/message", async (req, res) => {
    let { k, x, messageType } = req.body;
    if (!isFaulty && !currentNodeState.killed) {
      if (messageType == "propose") {
        if (!proposals.has(k)) {proposals.set(k, []);}
        proposals.get(k)!.push(x); 
        let proposal = proposals.get(k)!;

        if (proposal.length >= (N - F)) {
          let count0 = proposal.filter((el) => el == 0).length;
          let count1 = proposal.filter((el) => el == 1).length;
          if (count0 > (N / 2)) { x = 0;} 
          else if (count1 > (N / 2)) {x = 1;} 
          else {x = "?";}
          for (let index = 0; index < N; index++) {
            fetch(`http://localhost:${BASE_NODE_PORT + index}/message`, {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ k, x, messageType: "vote" })
            });
          }
        }
      }
      else if (messageType == "vote") {
        if (!votes.has(k)) {votes.set(k, []);}
        votes.get(k)!.push(x)
        let vote = votes.get(k)!;
          if (vote.length >= (N - F)) {
            console.log("vote", vote,"node :",nodeId,"k :",k)
            let count0 = vote.filter((el) => el == 0).length;
            let count1 = vote.filter((el) => el == 1).length;

            if (count0 >= F + 1) {
              currentNodeState.x = 0;
              currentNodeState.decided = true;
            } else if (count1 >= F + 1) {
              currentNodeState.x = 1;
              currentNodeState.decided = true;
            } else {
              // We'll enter this block if neither count0 nor count1 are greater than or equal to F+1
              if (count0 + count1 > 0) {
                currentNodeState.x = count0 > count1 ? 0 : 1;
              } else {
                // If both count0 and count1 are zero, decide randomly
                currentNodeState.x = Math.random() < 0.5 ? 0 : 1;
              }
              // Increment k for the next round of proposal
              currentNodeState.k = k + 1;
            
            

              for (let index = 0; index < N; index++) {
                fetch(`http://localhost:${BASE_NODE_PORT + index}/message`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ k: currentNodeState.k, x: currentNodeState.x, messageType: "propose" })
                });
              }
              
          }
        }
      }
    }
    res.status(200).send("Message received and processed.");
  });

  // Start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}