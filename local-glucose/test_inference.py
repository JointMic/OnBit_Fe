"""Execution checks only, not validation of physiological or glucose accuracy."""
import unittest
import numpy as np
import torch
from server import Engine

class InferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.engine=Engine()
    def test_model_shape_and_finite_output(self):
        with torch.inference_mode():out=self.engine.model(torch.tensor(self.engine.template[None,None,:]))
        self.assertEqual(tuple(out.shape),(1,));self.assertTrue(torch.isfinite(out).all())
    def test_template_similarity(self):
        import preprocessing as p
        score=p.morphology(self.engine.template[None,:],self.engine.template)[0]
        self.assertGreater(score,.99)
    def test_short_buffer(self):
        self.assertEqual(self.engine.infer({'samples':[[0,1],[.1,2]]})['status'],'buffering')
    def test_flat_signal_does_not_infer(self):
        x=[[float(t),200.] for t in np.arange(0,8,1/30)]
        self.assertNotEqual(self.engine.infer({'samples':x})['status'],'inferred')
    def test_gap_does_not_infer(self):
        times=np.r_[np.arange(0,3,1/30),np.arange(4,8,1/30)]
        self.assertEqual(self.engine.infer({'samples':[[float(t),1.] for t in times]})['status'],'buffering')
    def test_old_gap_recovers_with_continuous_tail(self):
        times=np.r_[np.arange(0,1,1/30),np.arange(2,8,1/30)]
        result=self.engine.infer({'samples':[[float(t),200.] for t in times]})
        self.assertNotIn(result['status'],('buffering','gap'))
    def test_bad_timestamps(self):
        with self.assertRaises(ValueError):self.engine.infer({'samples':[[1,2],[1,3]]})
    def test_extracted_functions_unchanged(self):
        import ast
        from pathlib import Path
        def funcs(path):
            tree=ast.parse(Path(path).read_text())
            return {n.name:ast.dump(n,include_attributes=False) for n in tree.body if isinstance(n,ast.FunctionDef)}
        source=funcs('vendor/step1_prepare.py');actual=funcs('preprocessing.py')
        for name in ['clean','local_range','detect','window_data','morphology']:
            self.assertEqual(source[name],actual[name])
if __name__=='__main__':unittest.main()
